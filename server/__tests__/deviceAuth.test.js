jest.mock('../securityLog', () => ({
  logAccessEvent: jest.fn(),
  logIdentityEvent: jest.fn(),
  logVaultEvent: jest.fn(),
}));

const { logAccessEvent } = require('../securityLog');
const { metrics } = require('../securityMetrics');
const {
  USER_CODE_ALPHABET,
  createDeviceAuth,
  formatUserCode,
  generateUserCode,
  normalizeUserCode,
  publicOrigin,
} = require('../deviceAuth');
const { createMemoryDeviceAuthStore } = require('../deviceAuthStore');

const approvedUser = { id: 'user-1', email: 'a@example.test', username: 'a', role: 'user', approval_status: 'approved' };
const pendingUser = { id: 'user-2', email: 'b@example.test', username: 'b', role: 'user', approval_status: 'pending' };

function makeReq({ ip = '10.88.0.10', origin, host = 'ata.uinjakarta.id', proto = 'https' } = {}) {
  const headers = { host, 'x-forwarded-proto': proto, 'x-forwarded-for': ip };
  if (origin) headers.origin = origin;
  return { headers, socket: { remoteAddress: '127.0.0.1' } };
}

function harness({ users = [approvedUser, pendingUser], sessions = [], options = {} } = {}) {
  let clock = new Date('2026-11-02T10:00:00.000Z');
  const store = createMemoryDeviceAuthStore({ users, sessions });
  const createSession = jest.fn(async () => 'session-token');
  const auth = createDeviceAuth({ store, createSession, now: () => clock, env: { NODE_ENV: 'production' }, options });
  return {
    auth,
    store,
    createSession,
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

async function fullFlow(h, { ip } = {}) {
  const started = await h.auth.start(makeReq({ ip }), { runtime: 'electron', deviceLabel: 'MacBook (darwin)', appVersion: '0.0.0' });
  await h.auth.approve(makeReq({ origin: 'https://ata.uinjakarta.id' }), approvedUser, { userCode: started.userCode });
  h.advance(5000);
  const polled = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
  return { started, polled };
}

beforeEach(() => {
  logAccessEvent.mockClear();
});

describe('user codes', () => {
  test('are 8 characters from the unambiguous alphabet, formatted XXXX-XXXX', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateUserCode();
      expect(code).toHaveLength(8);
      for (const char of code) expect(USER_CODE_ALPHABET).toContain(char);
    }
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOU01L]/);
    expect(formatUserCode('BCDFGHJK')).toBe('BCDF-GHJK');
  });

  test('normalize accepts human input and rejects impossible codes', () => {
    expect(normalizeUserCode(' bcdf-ghjk ')).toBe('BCDFGHJK');
    expect(normalizeUserCode('BCDF GHJK')).toBe('BCDFGHJK');
    expect(normalizeUserCode('BCDFGHJ')).toBeNull();
    expect(normalizeUserCode('BCDFGHJA')).toBeNull(); // vowel
    expect(normalizeUserCode('')).toBeNull();
    expect(normalizeUserCode(undefined)).toBeNull();
  });
});

describe('publicOrigin', () => {
  test('prefers APP_PUBLIC_ORIGIN, else the forwarded request origin', () => {
    expect(publicOrigin(makeReq(), { APP_PUBLIC_ORIGIN: 'http://localhost:5173/' })).toBe('http://localhost:5173');
    expect(publicOrigin(makeReq(), {})).toBe('https://ata.uinjakarta.id');
    expect(publicOrigin(makeReq({ proto: 'http', host: 'localhost:8790' }), {})).toBe('http://localhost:8790');
  });
});

describe('start', () => {
  test('issues a device code and a formatted user code with the verification URLs', async () => {
    const h = harness();
    const result = await h.auth.start(makeReq(), { runtime: 'electron', deviceLabel: 'MacBook (darwin)', appVersion: '0.0.0' });
    expect(result.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(result.verificationUrl).toBe('https://ata.uinjakarta.id/device');
    expect(result.verificationUrlComplete).toBe(`https://ata.uinjakarta.id/device?code=${result.userCode}`);
    expect(result.expiresIn).toBe(600);
    expect(result.interval).toBe(5);
    const [row] = [...h.store.rows.values()];
    expect(row.status).toBe('pending');
    expect(row.device_code_hash).not.toContain(result.deviceCode);
    expect(row.requester_ip).toBe('10.88.0.10');
    expect(metrics.deviceAuthStarted).toBeGreaterThan(0);
    // Neither code is logged.
    for (const [, payload] of logAccessEvent.mock.calls) {
      expect(JSON.stringify(payload)).not.toContain(result.deviceCode);
      expect(JSON.stringify(payload)).not.toContain(row.user_code);
    }
  });

  test('refuses a non-electron runtime', async () => {
    const h = harness();
    await expect(h.auth.start(makeReq(), { runtime: 'browser' })).rejects.toMatchObject({ status: 400 });
  });

  test('truncates the device label and app version', async () => {
    const h = harness();
    await h.auth.start(makeReq(), { runtime: 'electron', deviceLabel: 'x'.repeat(500), appVersion: 'y'.repeat(100) });
    const [row] = [...h.store.rows.values()];
    expect(row.device_label).toHaveLength(120);
    expect(row.app_version).toHaveLength(40);
  });

  test('keeps at most N pending codes per IP, expiring the oldest', async () => {
    const h = harness({ options: { pendingPerIp: 2 } });
    const a = await h.auth.start(makeReq(), { runtime: 'electron' });
    h.advance(10);
    const b = await h.auth.start(makeReq(), { runtime: 'electron' });
    h.advance(10);
    const c = await h.auth.start(makeReq(), { runtime: 'electron' });
    const statusOf = (started) => [...h.store.rows.values()].find((r) => formatUserCode(r.user_code) === started.userCode).status;
    expect(statusOf(a)).toBe('expired');
    expect(statusOf(b)).toBe('pending');
    expect(statusOf(c)).toBe('pending');
  });

  test('rate limits start per IP', async () => {
    const h = harness({ options: { startLimitPerIp: 2 } });
    await h.auth.start(makeReq(), { runtime: 'electron' });
    await h.auth.start(makeReq(), { runtime: 'electron' });
    await expect(h.auth.start(makeReq(), { runtime: 'electron' })).rejects.toMatchObject({ status: 429 });
    // Another IP is unaffected.
    await expect(h.auth.start(makeReq({ ip: '10.88.0.11' }), { runtime: 'electron' })).resolves.toBeTruthy();
  });
});

describe('poll', () => {
  test('is pending until approved, then yields a desktop session exactly once', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq(), { runtime: 'electron', deviceLabel: 'MacBook (darwin)' });

    const first = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(first).toMatchObject({ status: 428, body: { status: 'authorization_pending', interval: 5 } });

    await h.auth.approve(makeReq({ origin: 'https://ata.uinjakarta.id' }), approvedUser, { userCode: started.userCode });
    h.advance(5000);
    const second = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(second).toMatchObject({ status: 200, body: { status: 'approved' }, sessionToken: 'session-token' });
    expect(second.user).toMatchObject({ id: 'user-1' });
    expect(h.createSession).toHaveBeenCalledWith('user-1', expect.objectContaining({ client: 'desktop', deviceLabel: 'MacBook (darwin)', days: expect.any(Number) }));

    h.advance(5000);
    const third = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(third).toMatchObject({ status: 410, body: { status: 'consumed' } });
    expect(h.createSession).toHaveBeenCalledTimes(1);
  });

  test('enforces the poll interval', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    h.advance(1000);
    const fast = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(fast).toMatchObject({ status: 429, body: { status: 'slow_down' } });
    h.advance(5000);
    const ok = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(ok.status).toBe(428);
  });

  test('an unknown device code is 404 and a missing one is 400', async () => {
    const h = harness();
    await expect(h.auth.poll(makeReq(), { deviceCode: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(h.auth.poll(makeReq(), {})).rejects.toMatchObject({ status: 400 });
  });

  test('a code expires after its lifetime, even if it was approved', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await h.auth.approve(makeReq(), approvedUser, { userCode: started.userCode });
    h.advance(11 * 60_000);
    const polled = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(polled).toMatchObject({ status: 410, body: { status: 'expired' } });
    expect(h.createSession).not.toHaveBeenCalled();
  });

  test('a denied code reports denied', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await h.auth.deny(makeReq(), approvedUser, { userCode: started.userCode });
    const polled = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(polled).toMatchObject({ status: 403, body: { status: 'denied' } });
  });

  test('an approval whose user lost approval in the meantime yields no session', async () => {
    const users = [{ ...approvedUser }];
    const h = harness({ users });
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await h.auth.approve(makeReq(), approvedUser, { userCode: started.userCode });
    users[0].approval_status = 'rejected';
    const polled = await h.auth.poll(makeReq(), { deviceCode: started.deviceCode });
    expect(polled.status).toBe(403);
    expect(h.createSession).not.toHaveBeenCalled();
  });
});

describe('approve / deny / describe', () => {
  test('describe shows the device without approving it', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq({ ip: '10.88.0.10' }), { runtime: 'electron', deviceLabel: 'MacBook (darwin)', appVersion: '1.2.3' });
    const info = await h.auth.describe(makeReq(), approvedUser, started.userCode.toLowerCase());
    expect(info).toMatchObject({ userCode: started.userCode, deviceLabel: 'MacBook (darwin)', appVersion: '1.2.3', requesterIp: '10.88.0.10', expiresIn: 600 });
    expect([...h.store.rows.values()][0].status).toBe('pending');
  });

  test('only an approved account can approve', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await expect(h.auth.approve(makeReq(), pendingUser, { userCode: started.userCode })).rejects.toMatchObject({ status: 403 });
    await expect(h.auth.approve(makeReq(), null, { userCode: started.userCode })).rejects.toMatchObject({ status: 403 });
  });

  test('rejects a cross-site Origin on approve and deny', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await expect(h.auth.approve(makeReq({ origin: 'https://evil.example' }), approvedUser, { userCode: started.userCode }))
      .rejects.toMatchObject({ status: 403 });
    await expect(h.auth.deny(makeReq({ origin: 'https://evil.example' }), approvedUser, { userCode: started.userCode }))
      .rejects.toMatchObject({ status: 403 });
    expect([...h.store.rows.values()][0].status).toBe('pending');
  });

  test('a malformed code is 400 and does not count as a guess', async () => {
    const h = harness({ options: { wrongCodeLimitPerUser: 1 } });
    await expect(h.auth.approve(makeReq(), approvedUser, { userCode: 'abc' })).rejects.toMatchObject({ status: 400 });
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await expect(h.auth.approve(makeReq(), approvedUser, { userCode: started.userCode })).resolves.toMatchObject({ ok: true });
  });

  test('wrong codes are limited per user; a right code does not spend the budget', async () => {
    const h = harness({ options: { wrongCodeLimitPerUser: 2 } });
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await expect(h.auth.describe(makeReq(), approvedUser, 'BCDF-GHJK')).rejects.toMatchObject({ status: 404 });
    await expect(h.auth.describe(makeReq(), approvedUser, 'BCDF-GHJM')).rejects.toMatchObject({ status: 404 });
    await expect(h.auth.describe(makeReq(), approvedUser, started.userCode)).rejects.toMatchObject({ status: 429 });
    // Another user's budget is separate.
    const other = { ...approvedUser, id: 'user-3' };
    await expect(h.auth.describe(makeReq(), other, started.userCode)).resolves.toMatchObject({ userCode: started.userCode });
    await expect(h.auth.describe(makeReq(), other, started.userCode)).resolves.toBeTruthy();
    // After the window the first user may try again.
    h.advance(11 * 60_000);
    await expect(h.auth.describe(makeReq(), approvedUser, started.userCode)).rejects.toMatchObject({ status: 404 }); // expired by then
  });

  test('a code can be approved once; a second approval or denial is refused', async () => {
    const h = harness();
    const started = await h.auth.start(makeReq(), { runtime: 'electron' });
    await h.auth.approve(makeReq(), approvedUser, { userCode: started.userCode });
    await expect(h.auth.approve(makeReq(), approvedUser, { userCode: started.userCode })).rejects.toMatchObject({ status: 404 });
    await expect(h.auth.deny(makeReq(), approvedUser, { userCode: started.userCode })).rejects.toMatchObject({ status: 404 });
    expect(metrics.deviceAuthApproved).toBeGreaterThan(0);
  });
});

describe('sessions list / revoke', () => {
  const sessions = [
    { id: 's-web', user_id: 'user-1', client: 'web', device_label: null, token_hash: 'hash-web', created_at: new Date('2026-11-01T00:00:00Z'), last_seen_at: null, expires_at: new Date('2026-12-01T00:00:00Z') },
    { id: 's-desk', user_id: 'user-1', client: 'desktop', device_label: 'MacBook (darwin)', token_hash: 'hash-desk', created_at: new Date('2026-11-02T00:00:00Z'), last_seen_at: new Date('2026-11-02T09:00:00Z'), expires_at: new Date('2026-12-02T00:00:00Z') },
    { id: 's-other', user_id: 'user-9', client: 'web', device_label: null, token_hash: 'hash-other', created_at: new Date(), last_seen_at: null, expires_at: new Date('2026-12-02T00:00:00Z') },
  ];

  test('lists only the user\'s sessions and marks the current one', async () => {
    const h = harness({ sessions });
    const list = await h.auth.listSessions(approvedUser, 'hash-web');
    expect(list.map((s) => s.id)).toEqual(['s-web', 's-desk']);
    expect(list[0]).toMatchObject({ client: 'web', current: true });
    expect(list[1]).toMatchObject({ client: 'desktop', deviceLabel: 'MacBook (darwin)', current: false, lastSeenAt: '2026-11-02T09:00:00.000Z' });
    expect(list.some((s) => 'token_hash' in s || 'tokenHash' in s)).toBe(false);
  });

  test('revokes another session but not the current one or someone else\'s', async () => {
    const h = harness({ sessions });
    await expect(h.auth.revokeSession(approvedUser, 's-web', 'hash-web')).rejects.toMatchObject({ status: 400 });
    await expect(h.auth.revokeSession(approvedUser, 's-other', 'hash-web')).rejects.toMatchObject({ status: 404 });
    await expect(h.auth.revokeSession(approvedUser, 's-desk', 'hash-web')).resolves.toEqual({ ok: true });
    expect((await h.store.listSessions('user-1')).map((s) => s.id)).toEqual(['s-web']);
  });
});

describe('end to end with the memory store', () => {
  test('start → approve → poll hands the desktop a session for the approving user', async () => {
    const h = harness();
    const { polled } = await fullFlow(h);
    expect(polled.status).toBe(200);
    expect(polled.user.id).toBe('user-1');
  });

  test('sweep expires stale rows', async () => {
    const h = harness();
    await h.auth.start(makeReq(), { runtime: 'electron' });
    h.advance(11 * 60_000);
    await h.auth.sweep();
    expect([...h.store.rows.values()][0].status).toBe('expired');
  });
});
