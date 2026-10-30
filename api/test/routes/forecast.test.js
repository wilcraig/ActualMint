jest.mock('../../src/actual-client');
jest.mock('../../src/auth');
jest.mock('../../src/channels/store');
jest.mock('../../src/notify');
jest.mock('../../src/forecast/compute');

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-routes-'));
process.env.INSIGHTS_DATA_DIR = DATA_DIR;

const { getActualClient } = require('../../src/actual-client');
const { validateToken } = require('../../src/auth');
const { readChannels } = require('../../src/channels/store');
const { notify } = require('../../src/notify');
const { computeForecast } = require('../../src/forecast/compute');
const { appendHistory, readHistory } = require('../../src/forecast/state-store');
const { readSettings, writeSettings, defaultSettings } = require('../../src/forecast/settings-store');

const AUTH_HEADERS = { 'X-ACTUAL-TOKEN': 'valid-test-token' };
const JSON_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' };

async function withServer(fn) {
  const app = require('../../src/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const ACCOUNTS = [
  { id: 'a1', name: 'Checking', offbudget: false, closed: false },
  { id: 'a2', name: 'Brokerage', offbudget: true, closed: false },
  { id: 'a3', name: 'Old Savings', offbudget: false, closed: true },
  { id: 'a4', name: 'Savings', offbudget: false, closed: false },
];
const BALANCES = { a1: 123456, a4: 50000 };
const client = {
  getAccounts: jest.fn(async () => ACCOUNTS),
  getAccountBalance: jest.fn(async (id) => BALANCES[id]),
};

const ORIGINAL_TZ = process.env.TZ;

function clearDataDir() {
  for (const f of fs.readdirSync(DATA_DIR)) fs.rmSync(path.join(DATA_DIR, f), { force: true });
}

beforeEach(() => {
  clearDataDir();
  process.env.TZ = 'America/Denver';
  jest.useFakeTimers({
    now: new Date(2026, 9, 26, 10),
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
  });
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  getActualClient.mockReset();
  getActualClient.mockResolvedValue(client);
  readChannels.mockReset();
  readChannels.mockResolvedValue([{ id: 'c-ntfy', name: 'Phone', type: 'ntfy', config: {} }]);
  notify.mockReset();
  computeForecast.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
  process.env.TZ = ORIGINAL_TZ;
});
afterAll(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('every route is behind auth', async () => {
  validateToken.mockResolvedValue(false);
  await withServer(async (base) => {
    expect((await fetch(`${base}/api/forecast/settings`)).status).toBe(401);
    expect((await fetch(`${base}/api/forecast/settings`, { method: 'PUT', headers: JSON_HEADERS, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/forecast/check`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/forecast/test`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/forecast/history`)).status).toBe(401);
  });
  expect(notify).not.toHaveBeenCalled();
});

test('GET settings returns defaults, only on-budget open accounts with balances, and the time zone', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/settings`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: defaultSettings(),
      accounts: [
        { id: 'a1', name: 'Checking', balanceCents: 123456 },
        { id: 'a4', name: 'Savings', balanceCents: 50000 },
      ],
      timezone: 'America/Denver',
    });
  });
});

test('GET settings gives a null balance for an account whose balance cannot be read', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  client.getAccountBalance.mockImplementation(async (id) => {
    if (id === 'a4') throw new Error('balance query failed');
    return BALANCES[id];
  });
  try {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/forecast/settings`, { headers: AUTH_HEADERS });
      expect(res.status).toBe(200);
      expect((await res.json()).accounts).toEqual([
        { id: 'a1', name: 'Checking', balanceCents: 123456 },
        { id: 'a4', name: 'Savings', balanceCents: null },
      ]);
    });
  } finally {
    client.getAccountBalance.mockImplementation(async (id) => BALANCES[id]);
    errorSpy.mockRestore();
  }
});

test('PUT settings round-trips and drops account ids that are not eligible', async () => {
  const next = {
    enabled: true,
    windowDays: 20,
    time: '06:30',
    channelId: 'c-ntfy',
    accounts: {
      a1: { enabled: true, warningLevelCents: 10000 },
      a2: { enabled: true, warningLevelCents: 0 },
      a3: { enabled: true, warningLevelCents: 0 },
      gone: { enabled: true, warningLevelCents: 0 },
    },
  };
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(next) });
    expect(res.status).toBe(200);
    const expected = { ...next, accounts: { a1: next.accounts.a1 } };
    expect(await res.json()).toEqual({ settings: expected });
    expect(await readSettings(DATA_DIR)).toEqual(expected);
    const again = await fetch(`${base}/api/forecast/settings`, { headers: AUTH_HEADERS });
    expect((await again.json()).settings).toEqual(expected);
  });
});

test('PUT settings rejects invalid input with the field and saves nothing', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ...defaultSettings(), windowDays: 31 }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'windowDays' });
  });
  expect(fs.existsSync(path.join(DATA_DIR, 'forecast-settings.json'))).toBe(false);
});

test('PUT settings rejects turning the check on with no channel', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ...defaultSettings(), enabled: true }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Pick a channel to turn on the daily check', field: 'channelId' });
  });
  expect(fs.existsSync(path.join(DATA_DIR, 'forecast-settings.json'))).toBe(false);
});

test('PUT settings rejects a channel that does not exist', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ...defaultSettings(), channelId: 'c-gone' }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Pick a channel that exists', field: 'channelId' });
  });
  expect(fs.existsSync(path.join(DATA_DIR, 'forecast-settings.json'))).toBe(false);
});

test('POST check returns the forecast for enabled accounts and writes no history', async () => {
  const settings = { ...defaultSettings(), channelId: 'c-ntfy', accounts: { a1: { enabled: true, warningLevelCents: 10000 } } };
  await writeSettings(settings, DATA_DIR);
  const forecast = { generatedAt: new Date().toISOString(), windowDays: 15, today: '2026-10-26', results: [{ accountId: 'a1' }], errors: [] };
  computeForecast.mockResolvedValue(forecast);
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/check`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forecast });
  });
  expect(computeForecast.mock.calls[0][0].settings).toEqual(settings);
  expect(notify).not.toHaveBeenCalled();
  expect(await readHistory(DATA_DIR)).toEqual([]);
  expect(fs.existsSync(path.join(DATA_DIR, 'forecast-history.json'))).toBe(false);
});

test('POST test with no channel is a 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/test`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Pick a channel first' });
  });
  expect(notify).not.toHaveBeenCalled();
});

test('POST test sends through the configured channel', async () => {
  await writeSettings({ ...defaultSettings(), channelId: 'c-ntfy' }, DATA_DIR);
  notify.mockResolvedValue({ ok: true });
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/test`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  expect(notify).toHaveBeenCalledWith('c-ntfy', expect.any(Object), expect.anything());
});

test('POST test reports a failed send', async () => {
  await writeSettings({ ...defaultSettings(), channelId: 'c-ntfy' }, DATA_DIR);
  notify.mockResolvedValue({ ok: false, error: 'ntfy: server said no' });
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/test`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    expect(await res.json()).toEqual({ ok: false, error: 'ntfy: server said no' });
  });
});

test('GET history returns the stored entries', async () => {
  await appendHistory({ at: '2026-10-25T13:00:00.000Z', ok: true, trigger: 'schedule', warned: ['a1'] }, DATA_DIR);
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/history`, { headers: AUTH_HEADERS });
    expect(await res.json()).toEqual({ history: [{ at: '2026-10-25T13:00:00.000Z', ok: true, trigger: 'schedule', warned: ['a1'] }] });
  });
});

test('server errors do not echo internals', async () => {
  fs.writeFileSync(path.join(DATA_DIR, 'forecast-settings.json'), '{not json secret');
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/forecast/settings`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
  });
  errorSpy.mockRestore();
});
