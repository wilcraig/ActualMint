const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const { runCheck, previewCheck, sendTest } = require('../src/forecast/run');
const forecastSettings = require('../src/forecast/settings-store');
const summarySettings = require('../src/summary/settings-store');
const { readState, readHistory, writeState } = require('../src/forecast/state-store');

const NOW = new Date(2026, 9, 30, 7, 0);
const TODAY = '2026-10-30';

async function setup({ channelId = 'c-main', failureChannelId = 'c-alerts', accounts } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forecast-run-test-'));
  await forecastSettings.writeSettings(
    {
      enabled: true,
      windowDays: 15,
      time: '07:00',
      channelId,
      accounts: accounts || {
        a1: { enabled: true, warningLevelCents: 50000 },
        a2: { enabled: true, warningLevelCents: 20000 },
      },
    },
    dataDir
  );
  const summary = summarySettings.defaultSettings();
  summary.failureChannelId = failureChannelId;
  await summarySettings.writeSettings(summary, dataDir);
  return dataDir;
}

function result(accountId, accountName, breach) {
  return {
    accountId,
    accountName,
    warningLevelCents: 50000,
    balanceCents: 100000,
    allowancePerDayCents: 2000,
    allowanceNote: null,
    days: [],
    events: [],
    lowest: { date: '2026-11-05', balanceCents: breach ? 50000 - breach.shortfallCents : 80000 },
    breach: breach ? { balanceCents: 50000 - breach.shortfallCents, item: null, ...breach } : null,
  };
}

function forecast({ results = [], errors = [] } = {}) {
  return { generatedAt: NOW.toISOString(), windowDays: 15, today: TODAY, results, errors };
}

const SHORT = { date: '2026-11-05', shortfallCents: 10000 };

function fakes({ forecasts = [forecast()], results = [], alertResult = { ok: true } } = {}) {
  const queue = [...results];
  const client = { sync: jest.fn(async () => {}) };
  return {
    client,
    getClient: jest.fn(async () => client),
    syncIfDueImpl: jest.fn(async () => {}),
    notifyImpl: jest.fn(async (channelId) => (channelId === 'c-alerts' ? alertResult : queue.shift() || { ok: true })),
    sleep: jest.fn(async () => {}),
    computeImpl: jest.fn(async () => (forecasts.length > 1 ? forecasts.shift() : forecasts[0])),
  };
}

const run = (dataDir, f, trigger = 'schedule', now = NOW) => runCheck({ trigger, now, dataDir, ...f });
const mainCalls = (f) => f.notifyImpl.mock.calls.filter(([id]) => id === 'c-main');
const alertCalls = (f) => f.notifyImpl.mock.calls.filter(([id]) => id === 'c-alerts');

const exists = (p) => fs.access(p).then(() => true, () => false);

test('a new shortfall sends once, writes state, and history lists the account', async () => {
  const dataDir = await setup();
  const f = fakes({ forecasts: [forecast({ results: [result('a1', 'Checking', SHORT), result('a2', 'Joint', null)] })] });
  const out = await run(dataDir, f);
  expect(out).toMatchObject({ ok: true, sent: true });
  expect(out.forecast.results).toHaveLength(2);
  expect(f.syncIfDueImpl).toHaveBeenCalledWith(f.client);
  expect(f.computeImpl).toHaveBeenCalledWith(expect.objectContaining({ client: f.client, now: NOW }));
  expect(mainCalls(f)).toHaveLength(1);
  const [, message] = mainCalls(f)[0];
  expect(message.title).toBe('Low balance warning: Checking');
  expect(message.data.accounts.map((a) => a.accountId)).toEqual(['a1']);
  expect(await readState(dataDir)).toEqual({ a1: { firstDate: '2026-11-05', shortfallCents: 10000, sentAt: NOW.toISOString() } });
  expect(await readHistory(dataDir)).toEqual([{ at: NOW.toISOString(), ok: true, trigger: 'schedule', warned: ['a1'] }]);
});

test('running again with identical results sends nothing', async () => {
  const dataDir = await setup();
  const f = fakes({ forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })] });
  await run(dataDir, f);
  const later = new Date(2026, 9, 30, 8, 0);
  const out = await run(dataDir, f, 'catch-up', later);
  expect(out).toMatchObject({ ok: true, sent: false });
  expect(mainCalls(f)).toHaveLength(1);
  expect((await readState(dataDir)).a1.sentAt).toBe(NOW.toISOString());
  const history = await readHistory(dataDir);
  expect(history[0]).toEqual({ at: later.toISOString(), ok: true, trigger: 'catch-up', warned: [] });
});

test('a changed first date sends again', async () => {
  const dataDir = await setup();
  const f = fakes({
    forecasts: [
      forecast({ results: [result('a1', 'Checking', SHORT)] }),
      forecast({ results: [result('a1', 'Checking', { ...SHORT, date: '2026-11-02' })] }),
    ],
  });
  await run(dataDir, f);
  const out = await run(dataDir, f);
  expect(out.sent).toBe(true);
  expect(mainCalls(f)).toHaveLength(2);
  expect((await readState(dataDir)).a1.firstDate).toBe('2026-11-02');
});

test('a resolved shortfall clears state and sends nothing', async () => {
  const dataDir = await setup();
  await writeState({ a1: { firstDate: '2026-11-05', shortfallCents: 10000, sentAt: 'x' } }, dataDir);
  const f = fakes({ forecasts: [forecast({ results: [result('a1', 'Checking', null)] })] });
  const out = await run(dataDir, f);
  expect(out).toMatchObject({ ok: true, sent: false });
  expect(f.notifyImpl).not.toHaveBeenCalled();
  expect(await readState(dataDir)).toEqual({});
  expect((await readHistory(dataDir))[0]).toMatchObject({ ok: true, warned: [] });
});

test('fail, fail, succeed: retries after 2 then 6 minutes and records one success', async () => {
  const dataDir = await setup();
  const f = fakes({
    forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })],
    results: [{ ok: false, error: 'HTTP 502' }, { ok: false, error: 'HTTP 502' }, { ok: true }],
  });
  const out = await run(dataDir, f);
  expect(out).toMatchObject({ ok: true, sent: true });
  expect(f.sleep.mock.calls).toEqual([[120000], [360000]]);
  expect(mainCalls(f)).toHaveLength(3);
  expect(alertCalls(f)).toHaveLength(0);
  expect(await readHistory(dataDir)).toEqual([{ at: NOW.toISOString(), ok: true, trigger: 'schedule', warned: ['a1'] }]);
  expect(Object.keys(await readState(dataDir))).toEqual(['a1']);
});

test('failing three times leaves state unchanged, one failure entry, one alert', async () => {
  const dataDir = await setup();
  const prior = { a2: { firstDate: '2026-11-01', shortfallCents: 500, sentAt: 'earlier' } };
  await writeState(prior, dataDir);
  const f = fakes({
    forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })],
    results: [{ ok: false, error: 'Gmail: authentication failed' }, { ok: false, error: 'x' }, { ok: false, error: 'Gmail: authentication failed' }],
  });
  const out = await run(dataDir, f);
  expect(out).toMatchObject({ ok: false, sent: false, error: 'Gmail: authentication failed' });
  expect(mainCalls(f)).toHaveLength(3);
  expect(await readState(dataDir)).toEqual(prior);
  const history = await readHistory(dataDir);
  expect(history).toEqual([{ at: NOW.toISOString(), ok: false, trigger: 'schedule', warned: [], error: 'Gmail: authentication failed' }]);
  expect(alertCalls(f)).toHaveLength(1);
  const [, alert] = alertCalls(f)[0];
  expect(alert.title).toBe('Cash-flow check failed');
  expect(alert.text).toContain('Gmail: authentication failed');
});

test('no failure channel set: no alert, failure still recorded', async () => {
  const dataDir = await setup({ failureChannelId: null });
  const f = fakes({
    forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })],
    results: [{ ok: false, error: 'e' }, { ok: false, error: 'e' }, { ok: false, error: 'e' }],
  });
  await run(dataDir, f);
  expect(alertCalls(f)).toHaveLength(0);
  expect((await readHistory(dataDir))[0]).toMatchObject({ ok: false, error: 'e' });
});

test('the failure channel itself failing is still recorded in history', async () => {
  const dataDir = await setup();
  const f = fakes({
    forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })],
    results: [{ ok: false, error: 'e' }, { ok: false, error: 'e' }, { ok: false, error: 'e' }],
    alertResult: { ok: false, error: 'alerts down' },
  });
  const out = await run(dataDir, f);
  expect(out.ok).toBe(false);
  const history = await readHistory(dataDir);
  expect(history).toHaveLength(1);
  expect(history[0].ok).toBe(false);
  expect(history[0].error).toContain('e');
  expect(history[0].error).toContain('failure alert not sent: alerts down');
});

test('a channel that does not exist fails at once with no retry', async () => {
  const dataDir = await setup();
  const f = fakes({
    forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })],
    results: [{ ok: false, error: 'channel not found' }],
  });
  const out = await run(dataDir, f);
  expect(out).toMatchObject({ ok: false, error: 'channel not found' });
  expect(f.sleep).not.toHaveBeenCalled();
  expect(mainCalls(f)).toHaveLength(1);
  expect(alertCalls(f)).toHaveLength(1);
  expect(await readState(dataDir)).toEqual({});
});

test('one account erroring still sends the others and alerts naming the failed account', async () => {
  const dataDir = await setup();
  const prior = { a2: { firstDate: '2026-11-01', shortfallCents: 500, sentAt: 'earlier' } };
  await writeState(prior, dataDir);
  const f = fakes({
    forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)], errors: [{ accountId: 'a2', accountName: 'Joint', error: 'balance unavailable' }] })],
  });
  const out = await run(dataDir, f);
  expect(out.sent).toBe(true);
  expect(out.ok).toBe(false);
  expect(mainCalls(f)).toHaveLength(1);
  expect(mainCalls(f)[0][1].data.accounts.map((a) => a.accountId)).toEqual(['a1']);
  expect(alertCalls(f)).toHaveLength(1);
  const [, alert] = alertCalls(f)[0];
  expect(alert.title).toBe('Cash-flow check failed');
  expect(alert.text).toContain('Joint: balance unavailable');
  const state = await readState(dataDir);
  expect(state.a2).toEqual(prior.a2);
  expect(state.a1.firstDate).toBe('2026-11-05');
  const [entry] = await readHistory(dataDir);
  expect(entry).toMatchObject({ ok: false, warned: ['a1'] });
  expect(entry.error).toContain('Joint: balance unavailable');
});

test('a failure computing everything sends an alert and records a failure', async () => {
  const dataDir = await setup();
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const f = fakes();
  f.getClient.mockRejectedValue(new Error('Actual is down'));
  const out = await run(dataDir, f);
  errorSpy.mockRestore();
  expect(out.ok).toBe(false);
  expect(out.sent).toBe(false);
  expect(mainCalls(f)).toHaveLength(0);
  expect(alertCalls(f)).toHaveLength(1);
  expect(alertCalls(f)[0][1].title).toBe('Cash-flow check failed');
  expect((await readHistory(dataDir))[0]).toMatchObject({ ok: false, trigger: 'schedule', warned: [] });
  expect(await readState(dataDir)).toEqual({});
});

test('compute rejecting is caught the same way', async () => {
  const dataDir = await setup();
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const f = fakes();
  f.computeImpl.mockRejectedValue(new Error('schedules failed'));
  const out = await run(dataDir, f);
  errorSpy.mockRestore();
  expect(out.ok).toBe(false);
  expect(alertCalls(f)).toHaveLength(1);
  expect((await readHistory(dataDir))[0].ok).toBe(false);
});

test('a failed sync does not stop the check', async () => {
  const dataDir = await setup();
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const f = fakes({ forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })] });
  f.syncIfDueImpl.mockRejectedValue(new Error('network'));
  const out = await run(dataDir, f);
  errorSpy.mockRestore();
  expect(out).toMatchObject({ ok: true, sent: true });
});

test('no channel: returns ok, sent false, no history', async () => {
  const dataDir = await setup({ channelId: null });
  const f = fakes({ forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })] });
  expect(await run(dataDir, f)).toMatchObject({ ok: true, sent: false });
  expect(f.notifyImpl).not.toHaveBeenCalled();
  expect(f.computeImpl).not.toHaveBeenCalled();
  expect(await readHistory(dataDir)).toEqual([]);
});

test('no enabled accounts: returns ok, sent false, no history', async () => {
  const dataDir = await setup({ accounts: { a1: { enabled: false, warningLevelCents: 100 } } });
  const f = fakes({ forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })] });
  expect(await run(dataDir, f)).toMatchObject({ ok: true, sent: false });
  expect(f.notifyImpl).not.toHaveBeenCalled();
  expect(await readHistory(dataDir)).toEqual([]);
});

test('unreadable settings never throw', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forecast-run-test-'));
  await fs.writeFile(path.join(dataDir, 'forecast-settings.json'), '{bad');
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const out = await run(dataDir, fakes());
  errorSpy.mockRestore();
  expect(out.ok).toBe(false);
});

test('previewCheck computes but never sends and touches no state or history', async () => {
  const dataDir = await setup();
  const f = fakes({ forecasts: [forecast({ results: [result('a1', 'Checking', SHORT)] })] });
  const out = await previewCheck({ now: NOW, dataDir, ...f });
  expect(out.results).toHaveLength(1);
  expect(f.notifyImpl).not.toHaveBeenCalled();
  expect(await exists(path.join(dataDir, 'forecast-history.json'))).toBe(false);
});

test('previewCheck never throws when the client is unavailable', async () => {
  const dataDir = await setup();
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const f = fakes();
  f.getClient.mockRejectedValue(new Error('down'));
  const out = await previewCheck({ now: NOW, dataDir, ...f });
  errorSpy.mockRestore();
  expect(out.error).toBeTruthy();
  expect(await exists(path.join(dataDir, 'forecast-history.json'))).toBe(false);
});

test('sendTest makes one attempt and reports the failure', async () => {
  const dataDir = await setup();
  const notifyImpl = jest.fn(async () => ({ ok: false, error: 'HTTP 500' }));
  const out = await sendTest({ dataDir, notifyImpl });
  expect(out).toEqual({ ok: false, error: 'HTTP 500' });
  expect(notifyImpl).toHaveBeenCalledTimes(1);
  const [channelId, message] = notifyImpl.mock.calls[0];
  expect(channelId).toBe('c-main');
  expect(message.title).toBe('Cash-flow check test');
  expect(await exists(path.join(dataDir, 'forecast-history.json'))).toBe(false);
});

test('sendTest success, and no channel reports channel not found', async () => {
  const dataDir = await setup();
  expect(await sendTest({ dataDir, notifyImpl: jest.fn(async () => ({ ok: true })) })).toEqual({ ok: true });
  const noChannel = await setup({ channelId: null });
  const notifyImpl = jest.fn();
  expect(await sendTest({ dataDir: noChannel, notifyImpl })).toEqual({ ok: false, error: 'channel not found' });
  expect(notifyImpl).not.toHaveBeenCalled();
});
