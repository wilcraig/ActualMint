jest.mock('../../src/actual-client');
jest.mock('../../src/auth');
jest.mock('../../src/channels/store');
jest.mock('../../src/summary/deliver');
jest.mock('../../src/summary/build-summary');
jest.mock('../../src/summary/history-store');
jest.mock('../../src/summary/settings-store', () => {
  const actual = jest.requireActual('../../src/summary/settings-store');
  return { ...actual, readSettings: jest.fn(), writeSettings: jest.fn() };
});

const { getActualClient } = require('../../src/actual-client');
const { validateToken } = require('../../src/auth');
const { readChannels } = require('../../src/channels/store');
const { deliver } = require('../../src/summary/deliver');
const { buildSummary } = require('../../src/summary/build-summary');
const { readHistory, markReported } = require('../../src/summary/history-store');
const { readSettings, writeSettings, defaultSettings } = require('../../src/summary/settings-store');

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

const DELIVERY = { id: 'd1', name: 'Week in Review', enabled: true, channelId: 'c-ntfy', period: 'week', schedule: { days: [0], times: ['07:00'] } };
const SUMMARY = {
  schemaVersion: 1,
  generatedAt: '2026-10-29T13:00:00.000Z',
  delivery: { id: 'd1', name: 'Week in Review', period: 'week' },
  period: { start: '2026-10-22', end: '2026-10-28' },
  month: '2026-10',
  sections: { pacing: { title: 'Pacing', data: { overall: {} }, lines: ['On track: $1.00 spent, $2.00 expected by today'] } },
};

let stored;
const ORIGINAL_TZ = process.env.TZ;
const client = {
  sync: jest.fn(),
  getSchedules: jest.fn(async () => [
    { id: 's1', name: 'Mortgage', payee: 'p1', completed: false },
    { id: 's2', name: null, payee: 'p2', completed: false },
    { id: 's3', name: 'Old', payee: 'p1', completed: true },
  ]),
  aqlQuery: jest.fn(async () => ({ data: [{ id: 'p1', name: 'Bank' }, { id: 'p2', name: 'Gym' }, { id: 'p3', name: 'Checking', transfer_acct: 'a1' }] })),
};

beforeEach(() => {
  process.env.TZ = 'America/Denver';
  validateToken.mockReset();
  validateToken.mockResolvedValue(true);
  stored = defaultSettings();
  stored.deliveries = [DELIVERY];
  readSettings.mockReset();
  readSettings.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
  writeSettings.mockReset();
  writeSettings.mockImplementation(async (s) => { stored = s; });
  readChannels.mockReset();
  readChannels.mockResolvedValue([{ id: 'c-ntfy', name: 'Phone', type: 'ntfy', config: { topic: 'secret-topic' } }, { id: 'c-mail', name: 'Mail', type: 'email', config: {} }]);
  deliver.mockReset();
  buildSummary.mockReset();
  buildSummary.mockResolvedValue({ summary: SUMMARY, reportedIds: ['t1'] });
  readHistory.mockReset();
  markReported.mockReset();
  getActualClient.mockReset();
  getActualClient.mockResolvedValue(client);
});
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

test('every route is behind auth', async () => {
  validateToken.mockResolvedValue(false);
  await withServer(async (base) => {
    expect((await fetch(`${base}/api/summaries/settings`)).status).toBe(401);
    expect((await fetch(`${base}/api/summaries/settings`, { method: 'PUT', headers: JSON_HEADERS, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/summaries/preview`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/summaries/send`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/summaries/history`, { headers: AUTH_HEADERS })).status).toBe(401);
    expect((await fetch(`${base}/api/summaries/options`, { headers: AUTH_HEADERS })).status).toBe(401);
  });
  expect(deliver).not.toHaveBeenCalled();
});

test('GET settings returns settings, the section list and the server time zone', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/settings`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual(stored);
    expect(body.sections).toEqual([
      { id: 'pacing', title: 'Pacing' },
      { id: 'largest', title: 'Largest transactions' },
      { id: 'upcoming', title: 'Coming up' },
      { id: 'watched', title: 'Watched categories' },
      { id: 'alerts', title: 'Over budget' },
    ]);
    expect(body.timezone).toBe('America/Denver');
  });
});

test('PUT settings validates, saves and returns the normalized settings', async () => {
  const next = defaultSettings();
  next.deliveries = [{ ...DELIVERY, schedule: { days: [3, 1], times: ['07:00'] } }];
  next.failureChannelId = 'c-mail';
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(next) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.deliveries[0].schedule.days).toEqual([1, 3]);
    expect(stored.failureChannelId).toBe('c-mail');
  });
});

test('PUT settings rejects invalid input with the field', async () => {
  const bad = defaultSettings();
  bad.sections.largest.count = 99;
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(bad) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: 'sections.largest.count' });
  });
  expect(writeSettings).not.toHaveBeenCalled();
});

test('PUT settings rejects unknown channels for deliveries and failure alerts', async () => {
  const badDelivery = defaultSettings();
  badDelivery.deliveries = [{ ...DELIVERY, channelId: 'c-gone' }];
  const badFailure = defaultSettings();
  badFailure.failureChannelId = 'c-gone';
  await withServer(async (base) => {
    const one = await fetch(`${base}/api/summaries/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(badDelivery) });
    expect(one.status).toBe(400);
    expect(await one.json()).toEqual({ error: 'Pick a channel that exists', field: 'deliveries[0].channelId' });
    const two = await fetch(`${base}/api/summaries/settings`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(badFailure) });
    expect(two.status).toBe(400);
    expect((await two.json()).field).toBe('failureChannelId');
  });
  expect(writeSettings).not.toHaveBeenCalled();
});

test('preview by delivery id builds the message without sending or marking anything', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/preview`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ deliveryId: 'd1' }) });
    expect(res.status).toBe(200);
    const { message } = await res.json();
    expect(message.title).toBe('Budget summary: Week in Review');
    expect(message.text).toContain('On track');
    expect(message.data.schemaVersion).toBe(1);
  });
  expect(buildSummary.mock.calls[0][0].delivery).toEqual(DELIVERY);
  expect(deliver).not.toHaveBeenCalled();
  expect(markReported).not.toHaveBeenCalled();
});

test('preview of an unsaved draft delivery, with draft settings', async () => {
  const draftSettings = defaultSettings();
  draftSettings.sections.largest.count = 3;
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/preview`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ delivery: { ...DELIVERY, id: 'draft', period: 'yesterday' }, settings: draftSettings }),
    });
    expect(res.status).toBe(200);
  });
  const call = buildSummary.mock.calls[0][0];
  expect(call.delivery.period).toBe('yesterday');
  expect(call.settings.sections.largest.count).toBe(3);
  expect(markReported).not.toHaveBeenCalled();
});

test('preview rejects a bad draft and an unknown delivery', async () => {
  await withServer(async (base) => {
    const bad = await fetch(`${base}/api/summaries/preview`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ delivery: { ...DELIVERY, period: 'never' } }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).field).toBe('deliveries[0].period');
    const missing = await fetch(`${base}/api/summaries/preview`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ deliveryId: 'nope' }) });
    expect(missing.status).toBe(404);
  });
});

test('send runs a manual delivery and returns its outcome', async () => {
  deliver.mockResolvedValue({ ok: false, error: 'Gmail: authentication failed', summary: SUMMARY });
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/send`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ deliveryId: 'd1' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'Gmail: authentication failed' });
  });
  expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 'd1', trigger: 'manual' }));
});

test('send to an unknown delivery is a 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/send`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ deliveryId: 'nope' }) });
    expect(res.status).toBe(404);
  });
  expect(deliver).not.toHaveBeenCalled();
});

test('history', async () => {
  const history = [{ at: '2026-10-29T13:00:00.000Z', deliveryId: 'd1', deliveryName: 'Week in Review', ok: true, trigger: 'manual' }];
  readHistory.mockResolvedValue(history);
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/history`, { headers: AUTH_HEADERS });
    expect(await res.json()).toEqual({ history });
  });
});

test('options lists payees (no transfer payees) and open schedules for the exclusion pickers', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/options`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      payees: [{ id: 'p1', name: 'Bank' }, { id: 'p2', name: 'Gym' }],
      schedules: [{ id: 's1', name: 'Mortgage' }, { id: 's2', name: 'Gym' }],
    });
  });
});

test('server errors do not echo internals', async () => {
  readSettings.mockRejectedValue(Object.assign(new Error('EACCES secret-topic'), { code: 'EACCES' }));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/summaries/settings`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
  });
  errorSpy.mockRestore();
});
