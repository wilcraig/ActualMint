const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { writeChannels } = require('../src/channels/store');
const { CHANNEL_TYPES, listChannelTypes, ensureOk } = require('../src/channels/registry');
const { request } = require('../src/channels/http');
const { secretValues, scrubSecrets } = require('../src/channels/scrub');
const { notify } = require('../src/notify');

const SECRET_URL = 'https://hooks.example.test/services/T000/B000/s3cr3t-token-value';

CHANNEL_TYPES.fake = {
  type: 'fake',
  label: 'Fake',
  fields: [
    { key: 'url', label: 'URL', secret: true, required: true, kind: 'url' },
    { key: 'note', label: 'Note', secret: false, required: false, kind: 'text' },
    { key: 'headers', label: 'Headers', secret: true, required: false, kind: 'headers' },
  ],
  send: jest.fn(),
};

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notify-test-'));
  await writeChannels(
    [{ id: 'c1', name: 'Fake', type: 'fake', config: { url: SECRET_URL, note: 'hello', headers: [{ name: 'X-Auth', value: 'hdr-secret-123' }] } }],
    dir,
  );
  CHANNEL_TYPES.fake.send.mockReset();
});

const MESSAGE = { title: 't', text: 'body' };

test('notify returns ok and hands the channel its config and deps', async () => {
  CHANNEL_TYPES.fake.send.mockResolvedValue(undefined);
  const fetchImpl = jest.fn();
  expect(await notify('c1', MESSAGE, { dataDir: dir, fetchImpl })).toEqual({ ok: true });
  const [message, config, deps] = CHANNEL_TYPES.fake.send.mock.calls[0];
  expect(message).toEqual(MESSAGE);
  expect(config.note).toBe('hello');
  expect(deps.fetchImpl).toBe(fetchImpl);
});

test('an error that echoes the secret URL or a header value comes back scrubbed', async () => {
  CHANNEL_TYPES.fake.send.mockRejectedValue(
    new Error(`request to ${SECRET_URL} failed (token s3cr3t-token-value, auth hdr-secret-123, enc ${encodeURIComponent(SECRET_URL)})`),
  );
  const result = await notify('c1', MESSAGE, { dataDir: dir });
  expect(result.ok).toBe(false);
  expect(result.error).not.toContain('s3cr3t-token-value');
  expect(result.error).not.toContain('hdr-secret-123');
  expect(result.error).not.toContain('hooks.example.test');
  expect(result.error).toContain('***');
});

test('an unknown channel id is a result, not a throw', async () => {
  expect(await notify('nope', MESSAGE, { dataDir: dir })).toEqual({ ok: false, error: 'channel not found' });
});

test('an unreadable store is a result, not a throw', async () => {
  await fs.writeFile(path.join(dir, 'channels.json'), '{bad');
  const result = await notify('c1', MESSAGE, { dataDir: dir });
  expect(result.ok).toBe(false);
});

test('a rejected fetch and a non-2xx response both come back as ok:false', async () => {
  CHANNEL_TYPES.fake.send.mockImplementation((m, config, deps) => request(deps, config.url, { method: 'POST' }));

  const rejected = await notify('c1', MESSAGE, {
    dataDir: dir,
    fetchImpl: async (url) => { throw new Error(`connect ECONNREFUSED ${url}`); },
  });
  expect(rejected.ok).toBe(false);
  expect(rejected.error).toContain('ECONNREFUSED');
  expect(rejected.error).not.toContain('s3cr3t-token-value');

  const http500 = await notify('c1', MESSAGE, {
    dataDir: dir,
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  });
  expect(http500).toEqual({ ok: false, error: 'HTTP 500: boom' });
});

test('a hung request is aborted by the timeout', async () => {
  CHANNEL_TYPES.fake.send.mockImplementation((m, config, deps) => request(deps, config.url, {}));
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  const result = await notify('c1', MESSAGE, { dataDir: dir, fetchImpl, timeoutMs: 20 });
  expect(result.ok).toBe(false);
  expect(result.error).toBeTruthy();
});

test('ensureOk keeps at most 200 characters of the body', async () => {
  await expect(ensureOk({ ok: false, status: 400, text: async () => 'x'.repeat(500) })).rejects.toThrow(`HTTP 400: ${'x'.repeat(200)}`);
  await expect(ensureOk({ ok: true, status: 200 })).resolves.toBeUndefined();
});

test('secretValues lists secret fields only, with encoded and trailing-segment forms', () => {
  const values = secretValues('fake', { url: SECRET_URL, note: 'hello', headers: [{ name: 'a', value: 'v1' }] });
  expect(values).toEqual(expect.arrayContaining([SECRET_URL, encodeURIComponent(SECRET_URL), 's3cr3t-token-value', 'v1']));
  expect(values).not.toContain('hello');
  expect(scrubSecrets(`a ${SECRET_URL} b`, values)).toBe('a *** b');
});

test('listChannelTypes exposes metadata without functions', () => {
  const fake = listChannelTypes().find((t) => t.type === 'fake');
  expect(fake).toEqual({ type: 'fake', label: 'Fake', fields: CHANNEL_TYPES.fake.fields });
});
