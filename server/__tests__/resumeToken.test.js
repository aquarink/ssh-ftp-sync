jest.mock('../securityLog', () => ({
  logAccessEvent: jest.fn(),
  logIdentityEvent: jest.fn(),
  logVaultEvent: jest.fn(),
}));

const {
  consumeResumeToken,
  invalidateResumeTokens,
  issueResumeToken,
} = require('../resumeToken');

describe('resume tokens', () => {
  test('a freshly issued token resumes once for its own user and session', () => {
    const { token } = issueResumeToken({ userId: 7, sessionId: 'sess-a', ttlMs: 60000 });
    const result = consumeResumeToken(token, { userId: 7, sessionId: 'sess-a' });
    expect(result.scope).toEqual({ userId: 7, sessionId: 'sess-a' });
  });

  test('a token cannot be reused (one-time)', () => {
    const { token } = issueResumeToken({ userId: 7, sessionId: 'sess-b', ttlMs: 60000 });
    consumeResumeToken(token, { userId: 7, sessionId: 'sess-b' });
    expect(() => consumeResumeToken(token, { userId: 7, sessionId: 'sess-b' }))
      .toThrow(/no longer valid/);
  });

  test('another user cannot consume the token', () => {
    const { token } = issueResumeToken({ userId: 7, sessionId: 'sess-c', ttlMs: 60000 });
    expect(() => consumeResumeToken(token, { userId: 8, sessionId: 'sess-c' }))
      .toThrow(/scope mismatch/);
  });

  test('a token for another session is rejected', () => {
    const { token } = issueResumeToken({ userId: 7, sessionId: 'sess-d', ttlMs: 60000 });
    expect(() => consumeResumeToken(token, { userId: 7, sessionId: 'sess-other' }))
      .toThrow(/scope mismatch/);
  });

  test('an expired token is rejected', () => {
    const { token } = issueResumeToken({ userId: 7, sessionId: 'sess-e', ttlMs: 1 });
    const realNow = Date.now;
    Date.now = () => realNow() + 1000;
    try {
      expect(() => consumeResumeToken(token, { userId: 7, sessionId: 'sess-e' }))
        .toThrow(/expired|no longer valid/);
    } finally {
      Date.now = realNow;
    }
  });

  test('issuing a new token for a session invalidates the previous one', () => {
    const first = issueResumeToken({ userId: 7, sessionId: 'sess-f', ttlMs: 60000 });
    issueResumeToken({ userId: 7, sessionId: 'sess-f', ttlMs: 60000 });
    expect(() => consumeResumeToken(first.token, { userId: 7, sessionId: 'sess-f' }))
      .toThrow(/no longer valid/);
  });

  test('a tampered token signature is rejected', () => {
    const { token } = issueResumeToken({ userId: 7, sessionId: 'sess-g', ttlMs: 60000 });
    const [payload] = token.split('.');
    expect(() => consumeResumeToken(`${payload}.deadbeef`, { userId: 7, sessionId: 'sess-g' }))
      .toThrow(/Invalid resume authorization/);
  });

  test('invalidateResumeTokens removes a session\'s token', () => {
    const { token } = issueResumeToken({ userId: 7, sessionId: 'sess-h', ttlMs: 60000 });
    const removed = invalidateResumeTokens({ sessionId: 'sess-h' }, 'logout');
    expect(removed).toBe(1);
    expect(() => consumeResumeToken(token, { userId: 7, sessionId: 'sess-h' }))
      .toThrow(/no longer valid/);
  });
});
