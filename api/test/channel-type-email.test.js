const { CHANNEL_TYPES, listChannelTypes } = require('../src/channels/registry');

const MESSAGE = { title: 'Weekly summary', text: 'plain body', html: '<p>html body</p>' };

function fakeTransport() {
  const sendMail = jest.fn(async () => ({}));
  const createTransport = jest.fn(() => ({ sendMail }));
  return { sendMail, createTransport };
}

const BASE = { host: 'smtp.example.test', port: 2525, username: 'demo-user', password: 'demo-pass', from: 'a@example.test', to: 'b@example.test' };

test.each([
  ['starttls', { secure: false, requireTLS: true }],
  ['tls', { secure: true, requireTLS: false }],
  ['none', { secure: false, requireTLS: false }],
])('security %s maps to the transport options', async (security, expected) => {
  const { createTransport } = fakeTransport();
  await CHANNEL_TYPES.email.send(MESSAGE, { ...BASE, security }, { createTransport });
  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({ host: 'smtp.example.test', port: 2525, auth: { user: 'demo-user', pass: 'demo-pass' }, ...expected }),
  );
});

test('subject, text and html map onto the mail; html is omitted when absent', async () => {
  const t = fakeTransport();
  await CHANNEL_TYPES.email.send(MESSAGE, { ...BASE, security: 'tls' }, { createTransport: t.createTransport });
  expect(t.sendMail).toHaveBeenCalledWith({ from: 'a@example.test', to: 'b@example.test', subject: 'Weekly summary', text: 'plain body', html: '<p>html body</p>' });

  const t2 = fakeTransport();
  await CHANNEL_TYPES.email.send({ title: 'T', text: 'x' }, { ...BASE, security: 'tls' }, { createTransport: t2.createTransport });
  expect(t2.sendMail.mock.calls[0][0]).not.toHaveProperty('html');
});

test('no credentials means no auth block (open relay on the LAN)', async () => {
  const { createTransport } = fakeTransport();
  await CHANNEL_TYPES.email.send(MESSAGE, { host: 'h.example.test', port: 25, security: 'none', from: 'a@example.test', to: 'b@example.test' }, { createTransport });
  expect(createTransport.mock.calls[0][0]).not.toHaveProperty('auth');
});

test('a transport failure propagates', async () => {
  const createTransport = () => ({ sendMail: async () => { throw new Error('Invalid login'); } });
  await expect(CHANNEL_TYPES.email.send(MESSAGE, { ...BASE, security: 'tls' }, { createTransport })).rejects.toThrow('Invalid login');
});

test('validate rejects bad from/to addresses', () => {
  const { validate } = CHANNEL_TYPES.email;
  expect(validate({ ...BASE })).toBeNull();
  expect(validate({ ...BASE, from: 'nope' })).toMatch(/From/);
  expect(validate({ ...BASE, to: 'a@b' })).toMatch(/To/);
});

test('the Gmail preset is listed with its app-password note, and password is the only secret', () => {
  const email = listChannelTypes().find((t) => t.type === 'email');
  expect(email.presets).toEqual([
    expect.objectContaining({ id: 'gmail', values: { host: 'smtp.gmail.com', port: 587, security: 'starttls' }, note: expect.stringContaining('app password') }),
  ]);
  expect(email.fields.filter((f) => f.secret).map((f) => f.key)).toEqual(['password']);
});
