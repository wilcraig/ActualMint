const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const { deliver, RETRY_DELAYS_MS } = require('../src/summary/deliver');
const { defaultSettings, writeSettings } = require('../src/summary/settings-store');
const { readHistory, readReported } = require('../src/summary/history-store');

const NOW = new Date(2026, 9, 29, 7, 0);
const DELIVERY = { id: 'd1', name: 'Week in Review', enabled: true, channelId: 'c-main', period: 'week', schedule: { days: [4], times: ['07:00'] } };

const SUMMARY = {
  schemaVersion: 1,
  generatedAt: NOW.toISOString(),
  delivery: { id: 'd1', name: 'Week in Review', period: 'week' },
  period: { start: '2026-10-22', end: '2026-10-28' },
  month: '2026-10',
  sections: { largest: { title: 'Largest transactions', data: { items: [] }, lines: ['x'] } },
};

async function setup({ failureChannelId = 'c-alerts', delivery = DELIVERY } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-deliver-test-'));
  const settings = defaultSettings();
  settings.failureChannelId = failureChannelId;
  settings.deliveries = [delivery];
  await writeSettings(settings, dataDir);
  return dataDir;
}

function fakes({ results = [{ ok: true }], alertResult = { ok: true }, buildImpl } = {}) {
  const queue = [...results];
  const client = { sync: jest.fn(async () => {}) };
  return {
    client,
    getClient: jest.fn(async () => client),
    syncIfDueImpl: jest.fn(async () => {}),
    notifyImpl: jest.fn(async (channelId) => (channelId === 'c-alerts' ? alertResult : queue.shift() || { ok: false, error: 'out of results' })),
    sleep: jest.fn(async () => {}),
    buildImpl: buildImpl || jest.fn(async () => ({ summary: SUMMARY, reportedIds: ['t1', 't2'] })),
  };
}

async function run(dataDir, f, trigger = 'schedule') {
  return deliver({ deliveryId: 'd1', trigger, now: NOW, dataDir, ...f });
}

const mainCalls = (f) => f.notifyImpl.mock.calls.filter(([id]) => id === 'c-main');
const alertCalls = (f) => f.notifyImpl.mock.calls.filter(([id]) => id === 'c-alerts');

test('retries wait 2 then 6 minutes', () => {
  expect(RETRY_DELAYS_MS).toEqual([120000, 360000]);
});

test('success on the first try: one success entry, ids marked reported, no sleeps', async () => {
  const dataDir = await setup();
  const f = fakes();
  const result = await run(dataDir, f);
  expect(result).toMatchObject({ ok: true, summary: SUMMARY });
  expect(f.sleep).not.toHaveBeenCalled();
  const [, message] = mainCalls(f)[0];
  expect(message.title).toBe('Budget summary: Week in Review');
  expect(message.data.schemaVersion).toBe(1);
  expect(await readHistory(dataDir)).toEqual([{ at: NOW.toISOString(), deliveryId: 'd1', deliveryName: 'Week in Review', ok: true, trigger: 'schedule' }]);
  expect(await readReported('d1', dataDir)).toEqual(new Set(['t1', 't2']));
});

test('a scheduled send syncs if due; a manual one forces a sync', async () => {
  const dataDir = await setup();
  const f = fakes();
  await run(dataDir, f, 'schedule');
  expect(f.syncIfDueImpl).toHaveBeenCalledWith(f.client);
  expect(f.client.sync).not.toHaveBeenCalled();
  const g = fakes();
  await run(dataDir, g, 'manual');
  expect(g.client.sync).toHaveBeenCalled();
});

test('a failed sync does not stop the send', async () => {
  const dataDir = await setup();
  const f = fakes();
  f.client.sync.mockRejectedValue(new Error('network'));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect((await run(dataDir, f, 'manual')).ok).toBe(true);
  errorSpy.mockRestore();
});

test('fail, fail, succeed: one success entry and two sleeps', async () => {
  const dataDir = await setup();
  const f = fakes({ results: [{ ok: false, error: 'HTTP 502' }, { ok: false, error: 'HTTP 502' }, { ok: true }] });
  const result = await run(dataDir, f);
  expect(result.ok).toBe(true);
  expect(f.sleep.mock.calls).toEqual([[120000], [360000]]);
  expect(mainCalls(f)).toHaveLength(3);
  expect(alertCalls(f)).toHaveLength(0);
  const history = await readHistory(dataDir);
  expect(history).toHaveLength(1);
  expect(history[0].ok).toBe(true);
});

test('fails three times: one failure alert and one failure entry, nothing marked reported', async () => {
  const dataDir = await setup();
  const f = fakes({ results: [{ ok: false, error: 'Gmail: authentication failed' }, { ok: false, error: 'x' }, { ok: false, error: 'Gmail: authentication failed' }] });
  const result = await run(dataDir, f);
  expect(result).toMatchObject({ ok: false, error: 'Gmail: authentication failed' });
  expect(mainCalls(f)).toHaveLength(3);
  expect(alertCalls(f)).toHaveLength(1);
  const [, alert] = alertCalls(f)[0];
  expect(alert.title).toBe('Budget summary failed');
  expect(alert.text).toContain('Week in Review');
  expect(alert.text).toContain('Gmail: authentication failed');
  const history = await readHistory(dataDir);
  expect(history).toEqual([
    { at: NOW.toISOString(), deliveryId: 'd1', deliveryName: 'Week in Review', ok: false, error: 'Gmail: authentication failed', trigger: 'schedule' },
  ]);
  expect(await readReported('d1', dataDir)).toEqual(new Set());
});

test('the failure channel itself failing is still recorded', async () => {
  const dataDir = await setup();
  const f = fakes({ results: [{ ok: false, error: 'e' }, { ok: false, error: 'e' }, { ok: false, error: 'e' }], alertResult: { ok: false, error: 'alerts down' } });
  const result = await run(dataDir, f);
  expect(result.ok).toBe(false);
  const history = await readHistory(dataDir);
  expect(history).toHaveLength(1);
  expect(history[0].ok).toBe(false);
  expect(history[0].error).toContain('e');
  expect(history[0].error).toContain('failure alert not sent: alerts down');
});

test('no failure channel set: no alert, failure still recorded', async () => {
  const dataDir = await setup({ failureChannelId: null });
  const f = fakes({ results: [{ ok: false, error: 'e' }, { ok: false, error: 'e' }, { ok: false, error: 'e' }] });
  await run(dataDir, f);
  expect(alertCalls(f)).toHaveLength(0);
  expect((await readHistory(dataDir))[0]).toMatchObject({ ok: false, error: 'e' });
});

test('a deleted channel records channel not found without retries or a crash', async () => {
  const dataDir = await setup();
  const f = fakes({ results: [{ ok: false, error: 'channel not found' }] });
  const result = await run(dataDir, f);
  expect(result).toMatchObject({ ok: false, error: 'channel not found' });
  expect(f.sleep).not.toHaveBeenCalled();
  expect(mainCalls(f)).toHaveLength(1);
  expect(alertCalls(f)).toHaveLength(1);
  expect((await readHistory(dataDir))[0]).toMatchObject({ ok: false, error: 'channel not found' });
});

test('a delivery with no channel picked records channel not found', async () => {
  const dataDir = await setup({ delivery: { ...DELIVERY, channelId: null } });
  const f = fakes();
  const result = await run(dataDir, f);
  expect(result).toMatchObject({ ok: false, error: 'channel not found' });
  expect(mainCalls(f)).toHaveLength(0);
});

test('a deleted failure channel: the failure is still recorded', async () => {
  const dataDir = await setup({ failureChannelId: 'c-alerts' });
  const f = fakes({ results: [{ ok: false, error: 'e' }, { ok: false, error: 'e' }, { ok: false, error: 'e' }], alertResult: { ok: false, error: 'channel not found' } });
  await run(dataDir, f);
  expect((await readHistory(dataDir))[0].error).toContain('failure alert not sent: channel not found');
});

test('the builder throwing is caught and recorded', async () => {
  const dataDir = await setup();
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const f = fakes({ buildImpl: jest.fn(async () => { throw new Error('Actual is down'); }) });
  const result = await run(dataDir, f);
  errorSpy.mockRestore();
  expect(result).toMatchObject({ ok: false, error: 'could not build the summary' });
  expect(mainCalls(f)).toHaveLength(0);
  expect(alertCalls(f)).toHaveLength(1);
  expect((await readHistory(dataDir))[0]).toMatchObject({ ok: false, error: 'could not build the summary', trigger: 'schedule' });
});

test('an unknown delivery returns an error and never throws', async () => {
  const dataDir = await setup();
  const f = fakes();
  const result = await deliver({ deliveryId: 'nope', trigger: 'manual', now: NOW, dataDir, ...f });
  expect(result).toMatchObject({ ok: false, error: 'delivery not found' });
});

test('unreadable settings never throw', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-deliver-test-'));
  await fs.writeFile(path.join(dataDir, 'summary-settings.json'), '{bad');
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = await deliver({ deliveryId: 'd1', trigger: 'manual', now: NOW, dataDir, ...fakes() });
  errorSpy.mockRestore();
  expect(result.ok).toBe(false);
});
