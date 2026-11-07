const {
  GENERIC_RESENT,
  INVALID_LINK,
  createMemoryVerificationStore,
  createRateLimiter,
  createSignupVerification,
  hashToken,
} = require('../signupVerification');

const ORIGIN = 'https://ata.uinjakarta.id';

function harness({ users = [] } = {}) {
  let clock = new Date('2026-11-08T10:00:00Z');
  const store = createMemoryVerificationStore({ users });
  const mailer = { send: jest.fn(async () => ({ provider: 'primary', messageId: 'x' })) };
  const service = createSignupVerification({
    store,
    mailer,
    now: () => clock,
    rateLimiter: createRateLimiter({ limit: 3, windowMs: 3600_000, now: () => clock.getTime() }),
    ipRateLimiter: createRateLimiter({ limit: 10, windowMs: 3600_000, now: () => clock.getTime() }),
  });
  return {
    store,
    mailer,
    service,
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

function tokenFromLastMail(mailer) {
  const text = mailer.send.mock.calls.at(-1)[0].text;
  return new URL(text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
}

const pendingUser = { id: 'u1', email: 'new@example.test', email_verified_at: null, approval_status: 'pending' };

describe('issueAndSend', () => {
  test('mails a link on the request origin and stores only the token hash', async () => {
    const h = harness();
    await h.service.issueAndSend(pendingUser, ORIGIN);
    const link = h.mailer.send.mock.calls[0][0].text.match(/https:\/\/\S+/)[0];
    expect(link.startsWith(`${ORIGIN}/verify?token=`)).toBe(true);
    const token = tokenFromLastMail(h.mailer);
    const [row] = [...h.store.tokens.values()];
    expect(row.token_hash).toBe(hashToken(token));
    expect(row.token_hash).not.toBe(token);
    expect(row.user_id).toBe('u1');
  });

  test('a newer link invalidates the older open one', async () => {
    const h = harness();
    await h.service.issueAndSend(pendingUser, ORIGIN);
    const first = tokenFromLastMail(h.mailer);
    await h.service.issueAndSend(pendingUser, ORIGIN);
    await expect(h.service.consume(first)).rejects.toThrow(INVALID_LINK);
  });
});

describe('consume', () => {
  test('a fresh link verifies the email; a second use is refused', async () => {
    const users = [{ ...pendingUser }];
    const h = harness({ users });
    await h.service.issueAndSend(pendingUser, ORIGIN);
    const token = tokenFromLastMail(h.mailer);
    await expect(h.service.consume(token)).resolves.toEqual({ userId: 'u1' });
    expect(users[0].email_verified_at).toBeInstanceOf(Date);
    await expect(h.service.consume(token)).rejects.toMatchObject({ status: 400, message: INVALID_LINK });
  });

  test('a link expires after 24 hours', async () => {
    const users = [{ ...pendingUser }];
    const h = harness({ users });
    await h.service.issueAndSend(pendingUser, ORIGIN);
    const token = tokenFromLastMail(h.mailer);
    h.advance(24 * 3600_000 + 1000);
    await expect(h.service.consume(token)).rejects.toMatchObject({ status: 400 });
    expect(users[0].email_verified_at).toBeNull();
  });

  test('garbage and unknown tokens get the same generic answer', async () => {
    const h = harness();
    await expect(h.service.consume('short')).rejects.toMatchObject({ message: INVALID_LINK });
    await expect(h.service.consume('a'.repeat(43))).rejects.toMatchObject({ message: INVALID_LINK });
    await expect(h.service.consume(undefined)).rejects.toMatchObject({ message: INVALID_LINK });
  });

  test('an already verified account is not moved again', async () => {
    const verifiedAt = new Date('2026-11-01T00:00:00Z');
    const users = [{ ...pendingUser, email_verified_at: verifiedAt }];
    const h = harness({ users });
    await h.service.issueAndSend(pendingUser, ORIGIN);
    await h.service.consume(tokenFromLastMail(h.mailer));
    expect(users[0].email_verified_at).toEqual(verifiedAt);
  });
});

describe('resend', () => {
  test('sends a new link for a pending account and gives the generic answer', async () => {
    const h = harness({ users: [{ ...pendingUser }] });
    await expect(h.service.resend({ email: 'new@example.test', ip: '1.1.1.1', originForLink: ORIGIN }))
      .resolves.toEqual({ ok: true, message: GENERIC_RESENT });
    expect(h.mailer.send).toHaveBeenCalledTimes(1);
  });

  test('unknown, verified and rejected addresses get the same answer and no mail', async () => {
    const h = harness({
      users: [
        { ...pendingUser, id: 'v', email: 'verified@example.test', email_verified_at: new Date() },
        { ...pendingUser, id: 'r', email: 'rejected@example.test', approval_status: 'rejected' },
      ],
    });
    for (const email of ['nobody@example.test', 'verified@example.test', 'rejected@example.test']) {
      await expect(h.service.resend({ email, ip: '2.2.2.2', originForLink: ORIGIN })).resolves.toEqual({ ok: true, message: GENERIC_RESENT });
    }
    expect(h.mailer.send).not.toHaveBeenCalled();
  });

  test('the same address is limited to three requests an hour', async () => {
    const h = harness({ users: [{ ...pendingUser }] });
    for (let i = 0; i < 3; i += 1) {
      await h.service.resend({ email: 'new@example.test', ip: `10.0.0.${i}`, originForLink: ORIGIN });
    }
    await expect(h.service.resend({ email: 'new@example.test', ip: '10.0.0.9', originForLink: ORIGIN }))
      .rejects.toMatchObject({ status: 429 });
    h.advance(3600_000 + 1);
    await expect(h.service.resend({ email: 'new@example.test', ip: '10.0.0.9', originForLink: ORIGIN })).resolves.toBeTruthy();
  });

  test('one IP cannot send to many addresses past its own limit', async () => {
    const h = harness();
    for (let i = 0; i < 10; i += 1) {
      await h.service.resend({ email: `a${i}@example.test`, ip: '3.3.3.3', originForLink: ORIGIN });
    }
    await expect(h.service.resend({ email: 'b@example.test', ip: '3.3.3.3', originForLink: ORIGIN }))
      .rejects.toMatchObject({ status: 429 });
  });
});
