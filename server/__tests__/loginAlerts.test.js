const { createLoginAlerts, createMemoryLoginAlertStore, KNOWN_WINDOW_MS } = require('../loginAlerts');

const ORIGIN = 'https://ata.uinjakarta.id';
const user = {
  id: 'u1',
  email: 'owner@example.test',
  email_verified_at: new Date('2026-11-01T00:00:00Z'),
  login_alerts_enabled: true,
};

function harness({ userOverrides = {}, knownIps = [] } = {}) {
  let clock = new Date('2026-11-08T10:00:00Z');
  const store = createMemoryLoginAlertStore({ users: [{ ...user, ...userOverrides }] });
  for (const { ip, at } of knownIps) store.known.set(`u1|${ip}`, at);
  const mailer = { send: jest.fn(async () => ({ provider: 'primary' })) };
  const alerts = createLoginAlerts({ store, mailer, now: () => clock, logger: { error: jest.fn() } });
  return { store, mailer, alerts, advance: (ms) => { clock = new Date(clock.getTime() + ms); } };
}

const webSignIn = (ip) => ({ userId: 'u1', client: 'web', ip, origin: ORIGIN });

describe('web sign-ins', () => {
  test('the first sign-in of an account is recorded silently', async () => {
    const h = harness();
    await expect(h.alerts.onSignIn(webSignIn('10.1.1.1'))).resolves.toEqual({ alerted: false, reason: 'known_or_baseline' });
    expect(h.mailer.send).not.toHaveBeenCalled();
    expect(h.store.known.has('u1|10.1.1.1')).toBe(true);
  });

  test('a sign-in from an IP not seen in 30 days alerts', async () => {
    const h = harness({ knownIps: [{ ip: '10.1.1.1', at: new Date('2026-11-07T10:00:00Z') }] });
    await expect(h.alerts.onSignIn(webSignIn('203.0.113.9'))).resolves.toEqual({ alerted: true });
    expect(h.mailer.send).toHaveBeenCalledTimes(1);
    const message = h.mailer.send.mock.calls[0][0];
    expect(message).toMatchObject({ template: 'login_alert', to: 'owner@example.test' });
    expect(message.text).toContain('From IP: 203.0.113.9');
    expect(message.text).toContain(`${ORIGIN}/app/devices`);
  });

  test('a known IP does not alert again', async () => {
    const h = harness({ knownIps: [{ ip: '10.1.1.1', at: new Date('2026-11-07T10:00:00Z') }] });
    await h.alerts.onSignIn(webSignIn('10.1.1.1'));
    expect(h.mailer.send).not.toHaveBeenCalled();
  });

  test('an IP last seen more than 30 days ago counts as new again', async () => {
    const h = harness({ knownIps: [{ ip: '10.1.1.1', at: new Date(Date.parse('2026-11-08T10:00:00Z') - KNOWN_WINDOW_MS - 1000) }] });
    h.store.known.set('u1|10.9.9.9', new Date('2026-11-07T10:00:00Z'));
    await expect(h.alerts.onSignIn(webSignIn('10.1.1.1'))).resolves.toEqual({ alerted: true });
  });

  test('the user can switch alerts off', async () => {
    const h = harness({
      userOverrides: { login_alerts_enabled: false },
      knownIps: [{ ip: '10.1.1.1', at: new Date('2026-11-07T10:00:00Z') }],
    });
    await expect(h.alerts.onSignIn(webSignIn('203.0.113.9'))).resolves.toEqual({ alerted: false, reason: 'disabled' });
    expect(h.mailer.send).not.toHaveBeenCalled();
    expect(h.store.known.has('u1|203.0.113.9')).toBe(true);
  });

  test('unverified accounts get no alert', async () => {
    const h = harness({
      userOverrides: { email_verified_at: null },
      knownIps: [{ ip: '10.1.1.1', at: new Date('2026-11-07T10:00:00Z') }],
    });
    await expect(h.alerts.onSignIn(webSignIn('203.0.113.9'))).resolves.toEqual({ alerted: false, reason: 'unverified' });
  });
});

describe('desktop sign-ins', () => {
  test('always alert, even from a known IP', async () => {
    const h = harness({ knownIps: [{ ip: '10.1.1.1', at: new Date('2026-11-07T10:00:00Z') }] });
    await expect(h.alerts.onSignIn({ userId: 'u1', client: 'desktop', ip: '10.1.1.1', deviceLabel: 'MacBook (darwin)', origin: ORIGIN }))
      .resolves.toEqual({ alerted: true });
    expect(h.mailer.send.mock.calls[0][0].text).toContain('Desktop app (MacBook (darwin))');
  });
});

describe('failures never reach the sign-in', () => {
  test('a mail failure is logged and reported as not alerted', async () => {
    const h = harness({ knownIps: [{ ip: '10.1.1.1', at: new Date('2026-11-07T10:00:00Z') }] });
    h.mailer.send.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'ETIMEDOUT' }));
    await expect(h.alerts.onSignIn(webSignIn('203.0.113.9'))).resolves.toEqual({ alerted: false, reason: 'error' });
  });

  test('missing context or an unknown user does nothing', async () => {
    const h = harness();
    await expect(h.alerts.onSignIn({ userId: 'u1', client: 'web', ip: null })).resolves.toEqual({ alerted: false, reason: 'missing_context' });
    await expect(h.alerts.onSignIn({ userId: 'ghost', client: 'web', ip: '1.1.1.1' })).resolves.toEqual({ alerted: false, reason: 'no_user' });
    expect(h.mailer.send).not.toHaveBeenCalled();
  });
});
