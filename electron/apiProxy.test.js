const {
  installRelayCookieInjector,
  isSafeApiPath,
  pickForwardedHeaders,
  proxyApiRequest,
  registerApiProxyIpc,
  registerAppConfigIpc,
} = require('./apiProxy');

function fakeResponse({ ok = true, status = 200, statusText = 'OK', headers = {}, body = '' } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok,
    status,
    statusText,
    headers: { get: (name) => map.get(String(name).toLowerCase()) || null },
    text: async () => body,
  };
}

describe('isSafeApiPath', () => {
  test('accepts same-origin /api/ paths, with query strings', () => {
    expect(isSafeApiPath('/api/auth/session')).toBe(true);
    expect(isSafeApiPath('/api/hosts?x=1')).toBe(true);
    expect(isSafeApiPath('/api/x?u=http://example.test')).toBe(true);
  });

  test('rejects escapes and other origins', () => {
    expect(isSafeApiPath('/etc/passwd')).toBe(false);
    expect(isSafeApiPath('//evil.test/api/x')).toBe(false);
    expect(isSafeApiPath('/api/../admin')).toBe(false);
    expect(isSafeApiPath('/api/x\r\nHost: evil')).toBe(false);
    expect(isSafeApiPath('/api/http://evil.test')).toBe(false);
    expect(isSafeApiPath(42)).toBe(false);
    expect(isSafeApiPath(undefined)).toBe(false);
  });
});

describe('pickForwardedHeaders', () => {
  test('forwards only content-type and accept', () => {
    expect(pickForwardedHeaders({
      'Content-Type': 'application/json',
      Cookie: 'x',
      Authorization: 'y',
      Accept: 'a',
      'X-Nope': 1,
    })).toEqual({ 'Content-Type': 'application/json', Accept: 'a' });
    expect(pickForwardedHeaders(undefined)).toEqual({});
  });
});

describe('proxyApiRequest', () => {
  test('fetches the API origin with session credentials and returns JSON', async () => {
    const fetchImpl = jest.fn(async () => fakeResponse({
      headers: { 'content-type': 'application/json' },
      body: '{"user":{"id":"u1"}}',
    }));
    const res = await proxyApiRequest(
      { apiOrigin: 'https://ata.test', fetchImpl },
      { path: '/api/auth/session', headers: { Cookie: 'forged=1' } }
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ata.test/api/auth/session',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    );
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
    expect(res).toEqual({
      ok: true,
      status: 200,
      statusText: 'OK',
      contentType: 'application/json',
      payload: { user: { id: 'u1' } },
      text: '',
      server: null,
    });
  });

  test('passes string bodies for POST and surfaces non-JSON error bodies', async () => {
    const fetchImpl = jest.fn(async () => fakeResponse({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html', server: 'Caddy' },
      body: '<h1>upstream down</h1>',
    }));
    const res = await proxyApiRequest(
      { apiOrigin: 'https://ata.test', fetchImpl },
      { path: '/api/auth/login', method: 'post', body: '{"a":1}' }
    );
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"a":1}');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(res.text).toContain('upstream down');
    expect(res.server).toBe('Caddy');
    expect(res.payload).toEqual({});
  });

  test('rejects unsafe paths and methods without fetching', async () => {
    const fetchImpl = jest.fn();
    await expect(proxyApiRequest({ apiOrigin: 'https://ata.test', fetchImpl }, { path: '/api/../x' }))
      .rejects.toThrow(/Invalid API path/);
    await expect(proxyApiRequest({ apiOrigin: 'https://ata.test', fetchImpl }, { path: '/api/x', method: 'TRACE' }))
      .rejects.toThrow(/Unsupported/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('tolerates malformed JSON', async () => {
    const fetchImpl = jest.fn(async () => fakeResponse({ headers: { 'content-type': 'application/json' }, body: '{oops' }));
    const res = await proxyApiRequest({ apiOrigin: 'https://ata.test', fetchImpl }, { path: '/api/x' });
    expect(res.payload).toEqual({});
  });
});

describe('IPC registration', () => {
  test('api-request handler and synchronous app-config', async () => {
    const handlers = new Map();
    const listeners = new Map();
    const ipcMain = {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: (channel, fn) => listeners.set(channel, fn),
    };
    const fetchImpl = jest.fn(async () => fakeResponse({ headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }));
    const config = { apiOrigin: 'https://ata.test', wsOrigin: 'wss://ata.test', hostedMode: true };

    registerApiProxyIpc(ipcMain, { apiOrigin: 'https://ata.test', fetchImpl });
    registerAppConfigIpc(ipcMain, config);

    const res = await handlers.get('api-request')({}, { path: '/api/x' });
    expect(res.payload).toEqual({ ok: true });

    const event = {};
    listeners.get('app-config')(event);
    expect(event.returnValue).toEqual(config);
  });
});

describe('installRelayCookieInjector', () => {
  function fakeSession(cookies) {
    const calls = [];
    return {
      calls,
      cookies: { get: jest.fn(async () => cookies) },
      webRequest: { onBeforeSendHeaders: (filter, listener) => calls.push({ filter, listener }) },
    };
  }
  const run = (listener, details) => new Promise((resolve) => listener(details, resolve));

  test('filters the relay URLs and injects the session cookie', async () => {
    const session = fakeSession([{ name: 'ats_session', value: 'tok' }]);
    installRelayCookieInjector(session, { apiOrigin: 'https://ata.test', wsOrigin: 'wss://ata.test' });
    expect(session.calls[0].filter).toEqual({ urls: ['wss://ata.test/api/ssh*', 'https://ata.test/api/ssh*'] });

    const out = await run(session.calls[0].listener, { requestHeaders: { Upgrade: 'websocket' } });
    expect(out.requestHeaders).toEqual({ Upgrade: 'websocket', Cookie: 'ats_session=tok' });
    expect(session.cookies.get).toHaveBeenCalledWith({ url: 'https://ata.test', name: 'ats_session' });
  });

  test('leaves an existing Cookie header alone and copes with no cookie', async () => {
    const session = fakeSession([]);
    installRelayCookieInjector(session, { apiOrigin: 'https://ata.test', wsOrigin: 'wss://ata.test' });
    const { listener } = session.calls[0];
    expect((await run(listener, { requestHeaders: { cookie: 'a=b' } })).requestHeaders).toEqual({ cookie: 'a=b' });
    expect(session.cookies.get).not.toHaveBeenCalled();
    expect((await run(listener, { requestHeaders: {} })).requestHeaders).toEqual({});
  });

  test('a failing cookie store still lets the request through', async () => {
    const session = fakeSession([]);
    session.cookies.get = jest.fn(async () => { throw new Error('store closed'); });
    installRelayCookieInjector(session, { apiOrigin: 'https://ata.test', wsOrigin: 'wss://ata.test' });
    expect((await run(session.calls[0].listener, { requestHeaders: { A: '1' } })).requestHeaders).toEqual({ A: '1' });
  });
});
