const {
  createDeviceLoginController,
  isTrustedVerificationUrl,
  registerDeviceLoginIpc,
} = require('./deviceLogin');

const API = 'https://ata.uinjakarta.id';
// One clock for the whole file: the fake clock in harness() and the expiry in startBody().
const BASE_MS = Date.parse('2026-11-08T10:00:00Z');
const COMPLETE = `${API}/device?code=BCDF-GHJK`;

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function startBody(overrides = {}) {
  return {
    deviceCode: 'device-code-secret',
    userCode: 'BCDF-GHJK',
    verificationUrl: `${API}/device`,
    verificationUrlComplete: COMPLETE,
    expiresAt: new Date(BASE_MS + 600_000).toISOString(),
    expiresIn: 600,
    interval: 5,
    ...overrides,
  };
}

/**
 * A fake API that answers from a script. `sleep` never waits in real time; it
 * advances a fake clock and yields to the event loop so the poll loop runs.
 */
function harness({ replies = [], openExternal = jest.fn(async () => {}) } = {}) {
  let clock = BASE_MS;
  const calls = [];
  const sleeps = [];
  const queue = [...replies];
  const fetchImpl = jest.fn(async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const next = queue.shift();
    if (next === undefined) throw new Error('no scripted reply');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = async (ms, signal) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    sleeps.push(ms);
    clock += ms;
    await new Promise((resolve) => setImmediate(resolve));
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const controller = createDeviceLoginController({
    apiOrigin: API,
    fetchImpl,
    openExternal,
    deviceLabel: 'MacBook (darwin)',
    appVersion: '0.0.0',
    now: () => clock,
    sleep,
  });
  return { controller, calls, sleeps, fetchImpl, openExternal, advanceClock: (ms) => { clock += ms; } };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error('condition not reached');
}

describe('isTrustedVerificationUrl', () => {
  test('accepts only the configured origin', () => {
    expect(isTrustedVerificationUrl(COMPLETE, API)).toBe(true);
    expect(isTrustedVerificationUrl('https://evil.example/device?code=X', API)).toBe(false);
    expect(isTrustedVerificationUrl('http://ata.uinjakarta.id/device', API)).toBe(false);
    expect(isTrustedVerificationUrl('not a url', API)).toBe(false);
  });
});

describe('start', () => {
  test('posts the desktop runtime and label, returns the code, and opens the browser', async () => {
    const h = harness({ replies: [response(201, startBody())] });
    const result = await h.controller.start(() => {});
    expect(result).toMatchObject({ userCode: 'BCDF-GHJK', verificationUrl: COMPLETE });
    expect(h.calls[0]).toEqual({
      url: `${API}/api/auth/device/start`,
      body: { runtime: 'electron', deviceLabel: 'MacBook (darwin)', appVersion: '0.0.0' },
    });
    expect(h.openExternal).toHaveBeenCalledWith(COMPLETE);
    h.controller.cancel();
  });

  test('refuses a verification URL from another origin and never opens it', async () => {
    const h = harness({ replies: [response(201, startBody({ verificationUrlComplete: 'https://evil.example/device?code=X' }))] });
    await expect(h.controller.start(() => {})).rejects.toThrow(/outside the configured server/);
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  test('a server error on start is surfaced to the caller', async () => {
    const h = harness({ replies: [response(429, { error: 'Too many device authorization requests' })] });
    await expect(h.controller.start(() => {})).rejects.toThrow('Too many device authorization requests');
  });

  test('a browser that will not open is reported, but the code still works', async () => {
    const openExternal = jest.fn(async () => {
      throw new Error('no browser');
    });
    const statuses = [];
    const h = harness({ replies: [response(201, startBody()), response(428, { interval: 5 }), response(200, { user: { id: 'u1' } })], openExternal });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'approved'));
    expect(statuses[0]).toMatchObject({ state: 'browser_not_opened' });
  });
});

describe('polling', () => {
  test('pending, then approved; the approval carries the user and stops polling', async () => {
    const statuses = [];
    const h = harness({
      replies: [
        response(201, startBody()),
        response(428, { status: 'authorization_pending', interval: 5 }),
        response(200, { status: 'approved', user: { id: 'u1', email: 'a@x.test' } }),
      ],
    });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'approved'));
    expect(statuses.at(-1)).toEqual({ state: 'approved', user: { id: 'u1', email: 'a@x.test' } });
    const polls = h.calls.filter((c) => c.url.endsWith('/poll'));
    expect(polls).toHaveLength(2);
    expect(polls[0].body).toEqual({ deviceCode: 'device-code-secret' });
    expect(h.controller.isActive()).toBe(false);
  });

  test('slow_down lengthens the poll interval', async () => {
    const statuses = [];
    const h = harness({
      replies: [
        response(201, startBody()),
        response(429, { status: 'slow_down', interval: 5 }),
        response(403, { status: 'denied' }),
      ],
    });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'denied'));
    expect(statuses.at(-1)).toEqual({ state: 'denied' });
    // Waited 5 s, got slow_down, then waited 10 s before the next poll.
    expect(h.sleeps).toEqual([5000, 10000]);
  });

  test('a denied approval ends the flow as denied', async () => {
    const statuses = [];
    const h = harness({ replies: [response(201, startBody()), response(403, { status: 'denied' })] });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'denied'));
    expect(h.controller.isActive()).toBe(false);
  });

  test('a consumed or expired code (410) ends the flow as expired', async () => {
    const statuses = [];
    const h = harness({ replies: [response(201, startBody()), response(410, { status: 'consumed' })] });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'expired'));
  });

  test('the flow expires on the client clock even if the server never answered', async () => {
    const statuses = [];
    const replies = [response(201, startBody({ expiresAt: new Date(BASE_MS + 12_000).toISOString() }))];
    for (let i = 0; i < 5; i += 1) replies.push(response(428, { interval: 5 }));
    const h = harness({ replies });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'expired'));
    expect(h.calls.filter((c) => c.url.endsWith('/poll')).length).toBeLessThanOrEqual(3);
  });

  test('gives up after repeated network failures', async () => {
    const statuses = [];
    const replies = [response(201, startBody())];
    for (let i = 0; i < 10; i += 1) replies.push(new Error('socket hang up'));
    const h = harness({ replies });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'error'));
    expect(statuses.at(-1)).toEqual({ state: 'error', message: 'Lost contact with the server. Try again.' });
  });

  test('a single network blip does not end the flow', async () => {
    const statuses = [];
    const h = harness({
      replies: [
        response(201, startBody()),
        new Error('blip'),
        response(200, { status: 'approved', user: { id: 'u1' } }),
      ],
    });
    await h.controller.start((status) => statuses.push(status));
    await waitFor(() => statuses.some((s) => s.state === 'approved'));
  });
});

describe('cancel, replace and reopen', () => {
  test('a start whose reply arrives after a newer start is superseded and does not take over', async () => {
    const statuses = [];
    let resolveFirst;
    const firstReply = new Promise((resolve) => { resolveFirst = resolve; });
    const h = harness({ replies: [] });
    h.fetchImpl.mockReset();
    h.fetchImpl
      .mockImplementationOnce(() => firstReply)
      .mockImplementationOnce(async () => response(201, startBody({ userCode: 'BCDF-GHJK' })))
      .mockImplementation(async () => response(428, { interval: 5 }));

    const first = h.controller.start(() => {});
    const second = await h.controller.start((status) => statuses.push(status));
    resolveFirst(response(201, startBody({ userCode: 'AAAA-AAAA' })));
    await expect(first).rejects.toThrow('Superseded by a newer sign-in');
    expect(second.userCode).toBe('BCDF-GHJK');
    expect(h.controller.isActive()).toBe(true);
    h.controller.cancel();
    expect(h.controller.isActive()).toBe(false);
  });

  test('cancel stops polling and emits nothing further', async () => {
    const statuses = [];
    const h = harness({ replies: [response(201, startBody()), response(428, { interval: 5 })] });
    await h.controller.start((status) => statuses.push(status));
    h.controller.cancel();
    await flush();
    await flush();
    expect(statuses.filter((s) => s.state !== 'browser_not_opened')).toEqual([]);
    expect(h.calls.filter((c) => c.url.endsWith('/poll'))).toHaveLength(0);
    expect(h.controller.isActive()).toBe(false);
  });

  test('starting again cancels the old flow, whose later statuses are dropped', async () => {
    const oldStatuses = [];
    const newStatuses = [];
    const h = harness({
      replies: [
        response(201, startBody({ userCode: 'AAAA-AAAA' })),
        response(201, startBody({ userCode: 'BCDF-GHJK' })),
        response(200, { status: 'approved', user: { id: 'u2' } }),
      ],
    });
    await h.controller.start((status) => oldStatuses.push(status));
    await h.controller.start((status) => newStatuses.push(status));
    await waitFor(() => newStatuses.some((s) => s.state === 'approved'));
    expect(oldStatuses.some((s) => s.state === 'approved')).toBe(false);
  });

  test('reopen only ever opens the trusted URL of the flow in progress', async () => {
    const h = harness({ replies: [response(201, startBody()), response(428, { interval: 5 })] });
    await expect(h.controller.reopen()).rejects.toThrow('No sign-in is in progress');
    await h.controller.start(() => {});
    h.openExternal.mockClear();
    await h.controller.reopen();
    expect(h.openExternal).toHaveBeenCalledWith(COMPLETE);
    h.controller.cancel();
  });
});

describe('registerDeviceLoginIpc', () => {
  test('wires start/cancel/reopen and sends status to the calling window only', async () => {
    const handlers = new Map();
    const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
    const sender = { isDestroyed: () => false, send: jest.fn() };
    const replies = [response(201, startBody()), response(200, { status: 'approved', user: { id: 'u1' } })];
    const fetchImpl = jest.fn(async () => replies.shift());
    registerDeviceLoginIpc(ipcMain, {
      apiOrigin: API,
      fetchImpl,
      openExternal: jest.fn(async () => {}),
      deviceLabel: 'MacBook',
      appVersion: '0.0.0',
      sleep: async () => {},
    });
    expect([...handlers.keys()].sort()).toEqual(['device-login-cancel', 'device-login-reopen', 'device-login-start']);

    const result = await handlers.get('device-login-start')({ sender });
    expect(result.userCode).toBe('BCDF-GHJK');
    await waitFor(() => sender.send.mock.calls.length > 0);
    expect(sender.send).toHaveBeenCalledWith('device-login-status', { state: 'approved', user: { id: 'u1' } });
    expect(await handlers.get('device-login-cancel')()).toEqual({ ok: true });
  });

  test('status is not sent to a destroyed window', async () => {
    const handlers = new Map();
    registerDeviceLoginIpc({ handle: (name, fn) => handlers.set(name, fn) }, {
      apiOrigin: API,
      fetchImpl: jest.fn()
        .mockResolvedValueOnce(response(201, startBody()))
        .mockResolvedValueOnce(response(403, { status: 'denied' })),
      openExternal: jest.fn(async () => {}),
      deviceLabel: 'MacBook',
      appVersion: '0.0.0',
      sleep: async () => {},
    });
    const sender = { isDestroyed: () => true, send: jest.fn() };
    await handlers.get('device-login-start')({ sender });
    await flush();
    await flush();
    expect(sender.send).not.toHaveBeenCalled();
  });
});
