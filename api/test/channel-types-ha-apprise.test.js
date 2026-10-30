const { CHANNEL_TYPES } = require('../src/channels/registry');

const MESSAGE = { title: 'Weekly', text: 'plain body', markdown: '**md**', html: '<b>h</b>', data: { a: 1 } };

function okFetch() {
  return jest.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
}

test('homeassistant posts title, text, markdown and data to the webhook', async () => {
  const fetchImpl = okFetch();
  await CHANNEL_TYPES.homeassistant.send(MESSAGE, { baseUrl: 'http://ha.example.test:8123/', webhookId: 'hook-demo-1' }, { fetchImpl });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('http://ha.example.test:8123/api/webhook/hook-demo-1');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({ title: 'Weekly', text: 'plain body', markdown: '**md**', data: { a: 1 } });
});

test('apprise with a config key posts to /notify/{key}', async () => {
  const fetchImpl = okFetch();
  await CHANNEL_TYPES.apprise.send(MESSAGE, { apiUrl: 'http://apprise.example.test:8000/', configKey: 'family' }, { fetchImpl });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('http://apprise.example.test:8000/notify/family');
  expect(JSON.parse(init.body)).toEqual({ title: 'Weekly', body: 'plain body', format: 'text' });
});

test('apprise with target URLs posts to /notify with urls', async () => {
  const fetchImpl = okFetch();
  await CHANNEL_TYPES.apprise.send(
    MESSAGE,
    { apiUrl: 'http://apprise.example.test:8000', targets: 'json://a.example.test,json://b.example.test' },
    { fetchImpl },
  );
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('http://apprise.example.test:8000/notify');
  expect(JSON.parse(init.body)).toEqual({
    title: 'Weekly', body: 'plain body', format: 'text', urls: 'json://a.example.test,json://b.example.test',
  });
});

test('apprise validate needs a config key or targets', () => {
  const { validate } = CHANNEL_TYPES.apprise;
  expect(validate({ apiUrl: 'http://a.example.test' })).toMatch(/config key or target URLs/);
  expect(validate({ apiUrl: 'http://a.example.test', configKey: 'k' })).toBeNull();
  expect(validate({ apiUrl: 'http://a.example.test', targets: 'json://x.example.test' })).toBeNull();
});

test('homeassistant and apprise throw on non-2xx', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => 'nope' });
  await expect(CHANNEL_TYPES.homeassistant.send(MESSAGE, { baseUrl: 'http://h.example.test', webhookId: 'x' }, { fetchImpl })).rejects.toThrow('HTTP 404');
  await expect(CHANNEL_TYPES.apprise.send(MESSAGE, { apiUrl: 'http://a.example.test', configKey: 'k' }, { fetchImpl })).rejects.toThrow('HTTP 404');
});
