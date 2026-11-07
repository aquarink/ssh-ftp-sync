const { createMailer, isTransientError } = require('../mailer');

function transient() {
  return Object.assign(new Error('try later'), { responseCode: 451 });
}
function permanent() {
  return Object.assign(new Error('no such user'), { responseCode: 550 });
}

describe('mailer', () => {
  test('sends through the primary when it works', async () => {
    const primary = { name: 'primary', send: jest.fn(async () => ({ messageId: 'm1' })) };
    const fallback = { name: 'fallback', send: jest.fn(async () => ({})) };
    const mailer = createMailer({ senders: [primary, fallback], from: 'ata@uinjakarta.id' });
    const result = await mailer.send({ to: 'a@example.test', subject: 's', text: 't' });
    expect(result).toEqual({ provider: 'primary', messageId: 'm1' });
    expect(primary.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'ata@uinjakarta.id', to: 'a@example.test' }));
    expect(fallback.send).not.toHaveBeenCalled();
  });

  test('a transient failure on the primary falls back to the second account', async () => {
    const primary = { name: 'primary', send: jest.fn(async () => { throw transient(); }) };
    const fallback = { name: 'fallback', send: jest.fn(async () => ({ messageId: 'f1' })) };
    const mailer = createMailer({ senders: [primary, fallback], from: 'x@y.test' });
    await expect(mailer.send({ to: 'a@example.test' })).resolves.toEqual({ provider: 'fallback', messageId: 'f1' });
  });

  test('a permanent rejection is not retried on the fallback', async () => {
    const primary = { name: 'primary', send: jest.fn(async () => { throw permanent(); }) };
    const fallback = { name: 'fallback', send: jest.fn(async () => ({})) };
    const mailer = createMailer({ senders: [primary, fallback], from: 'x@y.test' });
    await expect(mailer.send({ to: 'nobody@example.test' })).rejects.toThrow('no such user');
    expect(fallback.send).not.toHaveBeenCalled();
  });

  test('when every sender is down the last error is thrown', async () => {
    const primary = { name: 'primary', send: jest.fn(async () => { throw transient(); }) };
    const fallback = { name: 'fallback', send: jest.fn(async () => { throw Object.assign(new Error('socket'), { code: 'ETIMEDOUT' }); }) };
    const mailer = createMailer({ senders: [primary, fallback], from: 'x@y.test' });
    await expect(mailer.send({ to: 'a@example.test' })).rejects.toThrow('socket');
  });

  test('without any configured sender it refuses with 503 instead of dropping the mail', async () => {
    const mailer = createMailer({ senders: [], from: 'x@y.test' });
    await expect(mailer.send({ to: 'a@example.test' })).rejects.toMatchObject({ status: 503 });
  });

  test('classifies 4xx and connection errors as transient, 5xx as permanent', () => {
    expect(isTransientError({ responseCode: 421 })).toBe(true);
    expect(isTransientError({ responseCode: 554 })).toBe(false);
    expect(isTransientError({ code: 'ECONNECTION' })).toBe(true);
    expect(isTransientError(new Error('other'))).toBe(false);
  });
});
