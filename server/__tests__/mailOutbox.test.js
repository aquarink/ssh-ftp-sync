const { createMemoryOutboxStore, createOutboxMailer } = require('../mailOutbox');

function harness({ sentToday = 0, dailyCap = 150, sendImpl } = {}) {
  const store = createMemoryOutboxStore();
  for (let i = 0; i < sentToday; i += 1) store.rows.push({ status: 'sent', created_at: new Date(), recipient: 'x', template: 't' });
  const inner = { send: jest.fn(sendImpl || (async () => ({ provider: 'primary', messageId: 'm' }))) };
  const mailer = createOutboxMailer({ mailer: inner, store, dailyCap });
  return { store, inner, mailer };
}

describe('mail outbox', () => {
  test('records a sent message with its template and provider, and strips the template before sending', async () => {
    const h = harness();
    await h.mailer.send({ template: 'login_alert', to: 'a@example.test', subject: 's', text: 't' });
    expect(h.inner.send.mock.calls[0][0]).not.toHaveProperty('template');
    expect(h.store.rows.at(-1)).toMatchObject({ status: 'sent', provider: 'primary', template: 'login_alert', recipient: 'a@example.test' });
  });

  test('a failed send is recorded with a short error code, not the message body', async () => {
    const h = harness({ sendImpl: async () => { throw Object.assign(new Error('secret body text'), { responseCode: 554 }); } });
    await expect(h.mailer.send({ template: 'signup_verification', to: 'a@example.test', text: 'link' })).rejects.toThrow();
    const row = h.store.rows.at(-1);
    expect(row).toMatchObject({ status: 'failed', last_error: '554' });
    expect(JSON.stringify(row)).not.toContain('secret body text');
  });

  test('at the daily cap nothing is sent, the message is deferred, and the caller gets 503', async () => {
    const h = harness({ sentToday: 2, dailyCap: 2 });
    await expect(h.mailer.send({ template: 'login_alert', to: 'a@example.test', text: 't' }))
      .rejects.toMatchObject({ status: 503, reason: 'daily_cap' });
    expect(h.inner.send).not.toHaveBeenCalled();
    expect(h.store.rows.at(-1)).toMatchObject({ status: 'deferred', last_error: 'daily cap reached' });
  });
});
