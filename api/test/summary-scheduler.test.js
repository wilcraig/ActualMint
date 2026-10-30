const { dueDeliveries, startScheduler } = require('../src/summary/scheduler');
const { defaultSettings } = require('../src/summary/settings-store');

// 2026-10-29 is a Thursday (4).
const THU = 4;
const at = (d, h, m = 0, s = 0) => new Date(2026, 9, d, h, m, s);

const delivery = (overrides = {}) => ({
  id: 'd1',
  name: 'Morning',
  enabled: true,
  channelId: 'c1',
  period: 'yesterday',
  schedule: { days: [THU], times: ['07:00'] },
  ...overrides,
});

function settingsWith(...deliveries) {
  const s = defaultSettings();
  s.deliveries = deliveries;
  return s;
}

const entry = (deliveryId, when, ok = true) => ({ at: when.toISOString(), deliveryId, deliveryName: 'x', ok, trigger: 'schedule' });

describe('dueDeliveries', () => {
  test('exact-minute match is due', () => {
    expect(dueDeliveries(settingsWith(delivery()), [], at(29, 7, 0, 30))).toEqual([{ deliveryId: 'd1', trigger: 'schedule', slot: at(29, 7) }]);
  });

  test('a minute early is not due', () => {
    expect(dueDeliveries(settingsWith(delivery()), [], at(29, 6, 59))).toEqual([]);
  });

  test('disabled delivery', () => {
    expect(dueDeliveries(settingsWith(delivery({ enabled: false })), [], at(29, 7))).toEqual([]);
  });

  test('wrong weekday', () => {
    expect(dueDeliveries(settingsWith(delivery({ schedule: { days: [1], times: ['07:00'] } })), [], at(29, 7))).toEqual([]);
  });

  test('no schedule: send on demand only', () => {
    expect(dueDeliveries(settingsWith(delivery({ schedule: { days: [], times: [] } })), [], at(29, 7))).toEqual([]);
  });

  test('several times in a day: the matching one is due', () => {
    const d = delivery({ schedule: { days: [THU], times: ['06:30', '18:00'] } });
    expect(dueDeliveries(settingsWith(d), [entry('d1', at(29, 6, 30))], at(29, 18))).toEqual([{ deliveryId: 'd1', trigger: 'schedule', slot: at(29, 18) }]);
  });

  test('one missed slot 3 hours ago is one catch-up', () => {
    expect(dueDeliveries(settingsWith(delivery()), [], at(29, 10))).toEqual([{ deliveryId: 'd1', trigger: 'catch-up', slot: at(29, 7) }]);
  });

  test('a slot 13 hours ago is skipped', () => {
    expect(dueDeliveries(settingsWith(delivery()), [], at(29, 20))).toEqual([]);
  });

  test('a missed slot from late yesterday counts', () => {
    const d = delivery({ schedule: { days: [3], times: ['22:00'] } });
    expect(dueDeliveries(settingsWith(d), [], at(29, 6))).toEqual([{ deliveryId: 'd1', trigger: 'catch-up', slot: at(28, 22) }]);
  });

  test('two missed slots still give one catch-up, for the latest', () => {
    const d = delivery({ schedule: { days: [THU], times: ['06:00', '08:00'] } });
    expect(dueDeliveries(settingsWith(d), [], at(29, 10))).toEqual([{ deliveryId: 'd1', trigger: 'catch-up', slot: at(29, 8) }]);
  });

  test('already sent after the slot: none', () => {
    expect(dueDeliveries(settingsWith(delivery()), [entry('d1', at(29, 7, 0, 5))], at(29, 10))).toEqual([]);
  });

  test('a failed attempt after the slot also counts as handled', () => {
    expect(dueDeliveries(settingsWith(delivery()), [entry('d1', at(29, 7, 8), false)], at(29, 10))).toEqual([]);
  });

  test("another delivery's history does not count", () => {
    expect(dueDeliveries(settingsWith(delivery()), [entry('d2', at(29, 8))], at(29, 10))).toHaveLength(1);
  });

  test('a scheduled slot due now wins over a catch-up', () => {
    const d = delivery({ schedule: { days: [THU], times: ['07:00', '10:00'] } });
    expect(dueDeliveries(settingsWith(d), [], at(29, 10))).toEqual([{ deliveryId: 'd1', trigger: 'schedule', slot: at(29, 10) }]);
  });

  test('catchUpBefore limits catch-ups to slots missed before that time', () => {
    expect(dueDeliveries(settingsWith(delivery()), [], at(29, 10), { catchUpBefore: at(29, 6) })).toEqual([]);
    expect(dueDeliveries(settingsWith(delivery()), [], at(29, 10), { catchUpBefore: at(29, 9) })).toHaveLength(1);
  });
});

describe('startScheduler', () => {
  // In-memory settings and history: real file I/O doesn't settle under
  // fake timers.
  const dataDir = '/nonexistent-summary-test-dir';
  let clock;
  let stop;
  let settings;
  let history;
  const appendHistory = async (e) => { history.unshift(e); };
  const io = () => ({ readSettingsImpl: async () => settings, readHistoryImpl: async () => history });

  beforeEach(() => {
    jest.useFakeTimers();
    clock = at(29, 6, 59, 30);
    history = [];
  });
  afterEach(() => {
    if (stop) stop();
    stop = null;
    jest.useRealTimers();
  });

  async function start(deliverImpl, deliveries = [delivery()]) {
    settings = settingsWith(...deliveries);
    stop = startScheduler({ dataDir, deliverImpl, intervalMs: 20000, now: () => clock, startedAt: at(29, 6, 59), ...io() });
  }

  async function advance(ms) {
    clock = new Date(clock.getTime() + ms);
    await jest.advanceTimersByTimeAsync(ms);
  }

  test('fires once at the scheduled minute even with several ticks in it', async () => {
    const deliverImpl = jest.fn(async ({ deliveryId, trigger, now }) => {
      await appendHistory({ at: now.toISOString(), deliveryId, deliveryName: 'x', ok: true, trigger });
      return { ok: true };
    });
    await start(deliverImpl);
    await advance(20000); // 06:59:50
    expect(deliverImpl).not.toHaveBeenCalled();
    await advance(20000); // 07:00:10
    await advance(20000); // 07:00:30
    await advance(20000); // 07:00:50
    await advance(60000); // 07:01:50
    expect(deliverImpl).toHaveBeenCalledTimes(1);
    expect(deliverImpl.mock.calls[0][0]).toMatchObject({ deliveryId: 'd1', trigger: 'schedule', dataDir });
  });

  test('a long-running delivery is never started twice and deliveries run one at a time', async () => {
    let release;
    let running = 0;
    let maxRunning = 0;
    const deliverImpl = jest.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => { release = resolve; });
      running--;
      return { ok: true };
    });
    await start(deliverImpl, [delivery(), delivery({ id: 'd2' })]);
    await advance(40000); // 07:00:10 -> both due, first starts
    await advance(5 * 60000); // still running, minutes pass, no history yet
    expect(deliverImpl).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(deliverImpl).toHaveBeenCalledTimes(2);
    release();
    await advance(60000);
    expect(deliverImpl).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
    expect(deliverImpl.mock.calls.map(([a]) => a.deliveryId)).toEqual(['d1', 'd2']);
  });

  test('catches up a slot missed while the server was down, on startup, once', async () => {
    clock = at(29, 9, 30);
    const deliverImpl = jest.fn(async ({ deliveryId, trigger, now }) => {
      await appendHistory({ at: now.toISOString(), deliveryId, deliveryName: 'x', ok: false, error: 'e', trigger });
      return { ok: false, error: 'e' };
    });
    settings = settingsWith(delivery());
    stop = startScheduler({ dataDir, deliverImpl, intervalMs: 20000, now: () => clock, ...io() });
    await jest.advanceTimersByTimeAsync(0);
    await advance(20000);
    await advance(20000);
    expect(deliverImpl).toHaveBeenCalledTimes(1);
    expect(deliverImpl.mock.calls[0][0].trigger).toBe('catch-up');
  });

  test('a deliver that throws does not stop the scheduler', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const deliverImpl = jest.fn(async () => { throw new Error('boom'); });
    await start(deliverImpl, [delivery({ schedule: { days: [THU], times: ['07:00', '07:01'] } })]);
    await advance(40000);
    await advance(60000);
    expect(deliverImpl).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
