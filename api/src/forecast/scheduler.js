const { dueDeliveries, CATCH_UP_WINDOW_MS } = require('../summary/scheduler');
const { readSettings } = require('./settings-store');
const { readHistory } = require('./state-store');
const { runCheck } = require('./run');

const MINUTE_MS = 60 * 1000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

// The daily check as one pseudo-delivery, so it shares the summary
// scheduler's slot and catch-up rules. Any history entry counts as an
// attempt, so a failed check is not caught up again.
// Returns { trigger: 'schedule' | 'catch-up', slot } or null.
function dueForecastCheck(settings, history, now, { catchUpBefore } = {}) {
  const pseudo = {
    deliveries: [{ id: 'forecast', enabled: !!settings.enabled, schedule: { days: EVERY_DAY, times: [settings.time] } }],
  };
  const entries = (history || []).map((e) => ({ deliveryId: 'forecast', at: e.at }));
  const [due] = dueDeliveries(pseudo, entries, now, { catchUpBefore });
  return due ? { trigger: due.trigger, slot: due.slot } : null;
}

// Checks for a due run now and every `intervalMs`. Each slot runs at most
// once per process, and a long check (with retries) never blocks or
// overlaps later ticks. Returns a function that stops the timer.
function startForecastScheduler({
  dataDir,
  runImpl = runCheck,
  intervalMs = MINUTE_MS,
  now = () => new Date(),
  startedAt,
  readSettingsImpl = readSettings,
  readHistoryImpl = readHistory,
}) {
  const catchUpBefore = startedAt || now();
  const handled = new Set(); // slot ms
  let ticking = false;
  let running = false;
  let stopped = false;

  async function run(trigger) {
    running = true;
    try {
      const result = await runImpl({ trigger, now: now(), dataDir });
      if (result && !result.ok) console.error(`forecast: ${trigger} check failed: ${result.error}`);
    } catch (err) {
      console.error('forecast: check threw:', (err && err.message) || err);
    } finally {
      running = false;
    }
  }

  async function tick() {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const current = now();
      const [settings, history] = await Promise.all([readSettingsImpl(dataDir), readHistoryImpl(dataDir)]);
      const due = dueForecastCheck(settings, history, current, { catchUpBefore });
      if (due && !handled.has(due.slot.getTime()) && !running && !stopped) {
        handled.add(due.slot.getTime());
        run(due.trigger); // not awaited: the tick loop stays free
      }
      for (const slotMs of handled) {
        if (current - slotMs > 2 * CATCH_UP_WINDOW_MS) handled.delete(slotMs);
      }
    } catch (err) {
      console.error('forecast: scheduler tick failed:', (err && err.code) || (err && err.message) || err);
    } finally {
      ticking = false;
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { dueForecastCheck, startForecastScheduler };
