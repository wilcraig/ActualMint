const { dueForecastCheck, startForecastScheduler } = require('../src/forecast/scheduler');

const at = (d, h, m = 0, s = 0) => new Date(2026, 9, d, h, m, s);
const settings = (o = {}) => ({ enabled: true, windowDays: 30, time: '07:00', channelId: 'c1', accounts: {}, ...o });
const entry = (when, ok = true) => ({ at: when.toISOString(), ok, trigger: 'schedule', warned: [] });

describe('dueForecastCheck', () => {
  test('due as schedule at the configured minute', () => {
    expect(dueForecastCheck(settings(), [], at(29, 7, 0, 30))).toEqual({ trigger: 'schedule', slot: at(29, 7) });
  });
  test('disabled is never due', () => {
    expect(dueForecastCheck(settings({ enabled: false }), [], at(29, 7))).toBeNull();
    expect(dueForecastCheck(settings({ enabled: false }), [], at(29, 7, 30))).toBeNull();
  });
  test('missed slot with no history is a catch-up', () => {
    expect(dueForecastCheck(settings(), [], at(29, 7, 30))).toEqual({ trigger: 'catch-up', slot: at(29, 7) });
  });
  test('history entry at or after the slot means not due, even a failure', () => {
    expect(dueForecastCheck(settings(), [entry(at(29, 7, 0, 5))], at(29, 7, 30))).toBeNull();
    expect(dueForecastCheck(settings(), [entry(at(29, 7), false)], at(29, 7, 30))).toBeNull();
  });
  test('slot older than 12 hours is not caught up', () => {
    expect(dueForecastCheck(settings(), [], at(29, 20))).toBeNull();
  });
  test('catchUpBefore limits catch-ups', () => {
    expect(dueForecastCheck(settings(), [], at(29, 7, 30), { catchUpBefore: at(29, 6, 59) })).toBeNull();
  });
});

describe('startForecastScheduler', () => {
  const dataDir = '/nonexistent-forecast-test-dir';
  let clock;
  let stop;
  let cfg;
  let history;
  const io = () => ({ readSettingsImpl: async () => cfg, readHistoryImpl: async () => history });

  beforeEach(() => {
    jest.useFakeTimers();
    clock = at(29, 6, 59, 30);
    cfg = settings();
    history = [];
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (stop) stop();
    stop = null;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const start = (runImpl, extra = {}) => {
    stop = startForecastScheduler({ dataDir, runImpl, intervalMs: 20000, now: () => clock, startedAt: at(29, 6, 59), ...io(), ...extra });
  };
  async function advance(ms) {
    clock = new Date(clock.getTime() + ms);
    await jest.advanceTimersByTimeAsync(ms);
  }

  test('runs once for the 07:00 slot across several ticks', async () => {
    const runImpl = jest.fn(async () => ({ ok: true }));
    start(runImpl);
    await advance(20000);
    expect(runImpl).not.toHaveBeenCalled();
    await advance(20000);
    await advance(20000);
    await advance(20000);
    await advance(60000);
    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(runImpl.mock.calls[0][0]).toMatchObject({ trigger: 'schedule', dataDir });
  });

  test('a slow check is not started twice', async () => {
    let release;
    const runImpl = jest.fn(() => new Promise((r) => { release = r; }));
    start(runImpl);
    await advance(40000);
    await advance(10 * 60000);
    expect(runImpl).toHaveBeenCalledTimes(1);
    release({ ok: true });
  });

  test('disabled never runs', async () => {
    cfg = settings({ enabled: false });
    const runImpl = jest.fn(async () => ({ ok: true }));
    start(runImpl);
    await advance(120000);
    expect(runImpl).not.toHaveBeenCalled();
  });

  test('catches up a slot missed while down, once', async () => {
    clock = at(29, 9, 30);
    const runImpl = jest.fn(async () => ({ ok: false, error: 'e' }));
    start(runImpl, { startedAt: undefined });
    await jest.advanceTimersByTimeAsync(0);
    await advance(20000);
    await advance(20000);
    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(runImpl.mock.calls[0][0].trigger).toBe('catch-up');
  });

  test('a slot missed after startedAt is not caught up', async () => {
    cfg = settings({ time: '07:10' });
    clock = at(29, 7, 20);
    const runImpl = jest.fn(async () => ({ ok: true }));
    start(runImpl, { startedAt: at(29, 7, 0) });
    await advance(60000);
    expect(runImpl).not.toHaveBeenCalled();
  });

  test('a runImpl that throws does not stop later ticks', async () => {
    const runImpl = jest.fn(async () => { throw new Error('boom'); });
    start(runImpl);
    await advance(40000); // 07:00:10, runs and throws
    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    cfg = settings({ time: '07:05' });
    await advance(5 * 60000); // 07:05:10, a new slot
    expect(runImpl).toHaveBeenCalledTimes(2);
  });

  test('stop before the due tick means no run', async () => {
    const runImpl = jest.fn(async () => ({ ok: true }));
    start(runImpl);
    await advance(0);
    stop();
    await advance(120000); // well past 07:00
    expect(runImpl).not.toHaveBeenCalled();
  });

  test('stop while a tick is reading settings means no run', async () => {
    clock = at(29, 7, 0, 10);
    let release;
    const runImpl = jest.fn(async () => ({ ok: true }));
    start(runImpl, { readSettingsImpl: () => new Promise((r) => { release = r; }) });
    await advance(0);
    stop();
    release(cfg);
    await advance(0);
    expect(runImpl).not.toHaveBeenCalled();
  });
});
