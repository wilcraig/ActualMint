const { CHANNEL_TYPES } = require('../src/channels/registry');

const MESSAGE = { title: 'Weekly', text: 'plain body', markdown: '**md body**', html: '<b>h</b>', data: { a: 1 } };
const TEXT_ONLY = { title: 'Weekly', text: 'plain body' };

function okFetch() {
  return jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
}

async function send(type, message, config) {
  const fetchImpl = okFetch();
  await CHANNEL_TYPES[type].send(message, config, { fetchImpl });
  const [url, init] = fetchImpl.mock.calls[0];
  return { url, init, headers: init.headers, body: init.body, fetchImpl };
}

const CASES = [
  {
    name: 'ntfy with markdown',
    type: 'ntfy',
    config: { server: 'https://ntfy.example.test/', topic: 'demo topic', token: 'tk_demo', priority: '4' },
    message: MESSAGE,
    expectUrl: 'https://ntfy.example.test/demo%20topic',
    check: ({ init, headers, body }) => {
      expect(init.method).toBe('POST');
      expect(body).toBe('**md body**');
      expect(headers).toEqual({ Title: 'Weekly', Priority: '4', Authorization: 'Bearer tk_demo', Markdown: 'yes' });
    },
  },
  {
    name: 'ntfy plain, no token',
    type: 'ntfy',
    config: { server: 'https://ntfy.example.test', topic: 't' },
    message: TEXT_ONLY,
    expectUrl: 'https://ntfy.example.test/t',
    check: ({ headers, body }) => {
      expect(body).toBe('plain body');
      expect(headers).toEqual({ Title: 'Weekly', Priority: '3' });
    },
  },
  {
    name: 'webhook sends the full JSON payload with custom headers',
    type: 'webhook',
    config: { url: 'https://hook.example.test/in', method: 'PUT', headers: [{ name: 'X-Auth', value: 'abc' }] },
    message: MESSAGE,
    expectUrl: 'https://hook.example.test/in',
    check: ({ init, headers, body }) => {
      expect(init.method).toBe('PUT');
      expect(headers).toEqual({ 'Content-Type': 'application/json', 'X-Auth': 'abc' });
      expect(JSON.parse(body)).toEqual({ title: 'Weekly', text: 'plain body', markdown: '**md body**', html: '<b>h</b>', data: { a: 1 } });
    },
  },
  {
    name: 'webhook defaults to POST',
    type: 'webhook',
    config: { url: 'https://hook.example.test/in' },
    message: TEXT_ONLY,
    expectUrl: 'https://hook.example.test/in',
    check: ({ init }) => expect(init.method).toBe('POST'),
  },
  {
    name: 'discord prefers markdown and truncates to 2000',
    type: 'discord',
    config: { url: 'https://discord.example.test/api/webhooks/1/tok' },
    message: { title: 't', text: 'x', markdown: 'm'.repeat(2500) },
    expectUrl: 'https://discord.example.test/api/webhooks/1/tok',
    check: ({ headers, body }) => {
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(body)).toEqual({ content: 'm'.repeat(2000) });
    },
  },
  {
    name: 'slack prefers markdown, falls back to text',
    type: 'slack',
    config: { url: 'https://slack.example.test/services/T/B/tok' },
    message: TEXT_ONLY,
    expectUrl: 'https://slack.example.test/services/T/B/tok',
    check: ({ body }) => expect(JSON.parse(body)).toEqual({ text: 'plain body' }),
  },
  {
    name: 'gotify keeps the token in a header, not the URL',
    type: 'gotify',
    config: { server: 'https://gotify.example.test/', token: 'AppTok123' },
    message: MESSAGE,
    expectUrl: 'https://gotify.example.test/message',
    check: ({ headers, body }) => {
      expect(headers['X-Gotify-Key']).toBe('AppTok123');
      expect(JSON.parse(body)).toEqual({ title: 'Weekly', message: 'plain body', priority: 5 });
    },
  },
  {
    name: 'pushover form-encodes and truncates the message to 1024',
    type: 'pushover',
    config: { appToken: 'app-demo', userKey: 'user-demo' },
    message: { title: 'T', text: 'y'.repeat(1500) },
    expectUrl: 'https://api.pushover.net/1/messages.json',
    check: ({ headers, body }) => {
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const form = new URLSearchParams(body);
      expect(form.get('token')).toBe('app-demo');
      expect(form.get('user')).toBe('user-demo');
      expect(form.get('title')).toBe('T');
      expect(form.get('message')).toBe('y'.repeat(1024));
    },
  },
  {
    name: 'telegram truncates to 4096 and disables link previews',
    type: 'telegram',
    config: { botToken: '123:demo-bot', chatId: '-100123' },
    message: { title: 'T', text: 'z'.repeat(5000) },
    expectUrl: 'https://api.telegram.org/bot123:demo-bot/sendMessage',
    check: ({ body }) =>
      expect(JSON.parse(body)).toEqual({ chat_id: '-100123', text: 'z'.repeat(4096), disable_web_page_preview: true }),
  },
];

test.each(CASES)('$name', async ({ type, config, message, expectUrl, check }) => {
  const result = await send(type, message, config);
  expect(result.url).toBe(expectUrl);
  expect(result.init.signal).toBeDefined();
  check(result);
});

test.each(['ntfy', 'webhook', 'discord', 'slack', 'gotify', 'pushover', 'telegram'])('%s throws on a non-2xx response', async (type) => {
  const config = {
    ntfy: { server: 'https://n.example.test', topic: 't' },
    webhook: { url: 'https://w.example.test' },
    discord: { url: 'https://d.example.test' },
    slack: { url: 'https://s.example.test' },
    gotify: { server: 'https://g.example.test', token: 'x' },
    pushover: { appToken: 'a', userKey: 'u' },
    telegram: { botToken: 'b', chatId: '1' },
  }[type];
  const fetchImpl = async () => ({ ok: false, status: 502, text: async () => 'bad gateway' });
  await expect(CHANNEL_TYPES[type].send(TEXT_ONLY, config, { fetchImpl })).rejects.toThrow('HTTP 502: bad gateway');
});

test('secret fields are flagged as the spec lists them', () => {
  const secretKeys = (type) => CHANNEL_TYPES[type].fields.filter((f) => f.secret).map((f) => f.key);
  expect(secretKeys('ntfy')).toEqual(['topic', 'token']);
  expect(secretKeys('webhook')).toEqual(['url', 'headers']);
  expect(secretKeys('discord')).toEqual(['url']);
  expect(secretKeys('slack')).toEqual(['url']);
  expect(secretKeys('gotify')).toEqual(['token']);
  expect(secretKeys('pushover')).toEqual(['appToken', 'userKey']);
  expect(secretKeys('telegram')).toEqual(['botToken']);
});
