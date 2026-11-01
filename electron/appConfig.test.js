const {
  DEFAULT_HOSTED_ORIGIN,
  getAppConfig,
  isLocalOrigin,
  normalizeOrigin,
  resolveApiOrigin,
  toWebSocketOrigin,
} = require('./appConfig');

describe('resolveApiOrigin', () => {
  test('explicit ATA_API_ORIGIN wins and is normalised to an origin', () => {
    expect(resolveApiOrigin({ env: { ATA_API_ORIGIN: 'https://ata.example.test/some/path' }, isDev: true }))
      .toBe('https://ata.example.test');
  });

  test('ignores an invalid or non-http ATA_API_ORIGIN', () => {
    expect(resolveApiOrigin({ env: { ATA_API_ORIGIN: 'not a url' }, isDev: false })).toBe(DEFAULT_HOSTED_ORIGIN);
    expect(resolveApiOrigin({ env: { ATA_API_ORIGIN: 'ftp://x' }, isDev: false })).toBe(DEFAULT_HOSTED_ORIGIN);
  });

  test('development defaults to the local API on API_PORT', () => {
    expect(resolveApiOrigin({ env: { API_PORT: '9000' }, isDev: true })).toBe('http://127.0.0.1:9000');
    expect(resolveApiOrigin({ env: {}, isDev: true })).toBe('http://127.0.0.1:8790');
  });

  test('production defaults to the hosted origin', () => {
    expect(resolveApiOrigin({ env: {}, isDev: false })).toBe(DEFAULT_HOSTED_ORIGIN);
  });

  test('isDev is derived from NODE_ENV when not given', () => {
    expect(resolveApiOrigin({ env: { NODE_ENV: 'development' } })).toBe('http://127.0.0.1:8790');
    expect(resolveApiOrigin({ env: { NODE_ENV: 'production' } })).toBe(DEFAULT_HOSTED_ORIGIN);
  });
});

describe('getAppConfig', () => {
  test('derives the websocket origin and hosted mode', () => {
    expect(getAppConfig({ env: {}, isDev: false })).toEqual({
      apiOrigin: DEFAULT_HOSTED_ORIGIN,
      wsOrigin: 'wss://ata.uinjakarta.id',
      hostedMode: true,
    });
    expect(getAppConfig({ env: {}, isDev: true })).toEqual({
      apiOrigin: 'http://127.0.0.1:8790',
      wsOrigin: 'ws://127.0.0.1:8790',
      hostedMode: false,
    });
  });
});

describe('helpers', () => {
  test('normalizeOrigin strips paths and rejects junk', () => {
    expect(normalizeOrigin('http://localhost:8790/')).toBe('http://localhost:8790');
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
  });

  test('isLocalOrigin recognises loopback hosts only', () => {
    expect(isLocalOrigin('http://localhost:8790')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:8790')).toBe(true);
    expect(isLocalOrigin('http://[::1]:8790')).toBe(true);
    expect(isLocalOrigin('https://ata.uinjakarta.id')).toBe(false);
    expect(isLocalOrigin('garbage')).toBe(false);
  });

  test('toWebSocketOrigin maps http(s) to ws(s)', () => {
    expect(toWebSocketOrigin('https://a.b')).toBe('wss://a.b');
    expect(toWebSocketOrigin('http://a.b:1')).toBe('ws://a.b:1');
  });
});
