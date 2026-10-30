const { deliver } = require('./deliver');
const { readHistory } = require('./history-store');
const { readSettings } = require('./settings-store');

// A slot older than this is stale: skipped rather than sent late.
const CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function slotsAround(delivery, now) {
  const slots = [];
  for (const dayOffset of [-1, 0]) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    if (!delivery.schedule.days.includes(day.getDay())) continue;
    for (const time of delivery.schedule.times) {
      const [hours, minutes] = time.split(':').map(Number);
      slots.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes));
    }
  }
  return slots.sort((a, b) => a - b);
}

// Which deliveries should go out at `now`, from settings and send history
// alone. Each enabled, scheduled delivery is due:
// - 'schedule' when one of today's times is `now`'s minute (in the server's
//   TZ, like everything else here);
// - otherwise 'catch-up' when a slot in the last 12 hours has no history
//   entry (success or failure) at or after it. One catch-up at most per
//   delivery, for its latest missed slot. `catchUpBefore` limits catch-ups
//   to slots before that time: the scheduler passes its start time, so only
//   sends missed while the server was down are caught up.
// Returns [{ deliveryId, trigger, slot }].
function dueDeliveries(settings, history, now, { catchUpBefore } = {}) {
  const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  const due = [];

  for (const delivery of settings.deliveries || []) {
    if (!delivery.enabled || !delivery.schedule) continue;
    const slots = slotsAround(delivery, now);
    if (slots.length === 0) continue;

    const current = slots.find((slot) => slot.getTime() === minuteStart.getTime());
    if (current) {
      due.push({ deliveryId: delivery.id, trigger: 'schedule', slot: current });
      continue;
    }

    const attempts = (history || []).filter((e) => e.deliveryId === delivery.id).map((e) => new Date(e.at).getTime());
    const missed = slots.filter(
      (slot) =>
        slot < minuteStart &&
        now - slot < CATCH_UP_WINDOW_MS &&
        (!catchUpBefore || slot < catchUpBefore) &&
        !attempts.some((t) => t >= slot.getTime())
    );
    if (missed.length > 0) due.push({ deliveryId: delivery.id, trigger: 'catch-up', slot: missed[missed.length - 1] });
  }
  return due;
}

// Checks for due deliveries now and every `intervalMs`, and runs them one
// at a time in the order they came due. Each slot is sent at most once per
// process, however many ticks land in its minute or however long a send
// (with its retries) takes. Returns a function that stops the timer.
function startScheduler({
  dataDir,
  deliverImpl = deliver,
  intervalMs = MINUTE_MS,
  now = () => new Date(),
  startedAt,
  readSettingsImpl = readSettings,
  readHistoryImpl = readHistory,
}) {
  const catchUpBefore = startedAt || now();
  const handled = new Map(); // `${deliveryId}@${slotMs}` -> slotMs
  const queue = [];
  let ticking = false;
  let draining = false;
  let stopped = false;

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length > 0 && !stopped) {
      const { deliveryId, trigger } = queue.shift();
      try {
        const result = await deliverImpl({ deliveryId, trigger, now: now(), dataDir });
        // deliver() scrubs secrets from its errors before returning them.
        if (result && !result.ok) console.error(`summary: delivery ${deliveryId} (${trigger}) failed: ${result.error}`);
      } catch (err) {
        console.error(`summary: delivery ${deliveryId} threw:`, (err && err.message) || err);
      }
    }
    draining = false;
  }

  async function tick() {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const current = now();
      const [settings, history] = await Promise.all([readSettingsImpl(dataDir), readHistoryImpl(dataDir)]);
      for (const due of dueDeliveries(settings, history, current, { catchUpBefore })) {
        const key = `${due.deliveryId}@${due.slot.getTime()}`;
        if (handled.has(key)) continue;
        handled.set(key, due.slot.getTime());
        queue.push(due);
      }
      // Slots older than the catch-up window can never be due again.
      for (const [key, slotMs] of handled) {
        if (current - slotMs > 2 * CATCH_UP_WINDOW_MS) handled.delete(key);
      }
    } catch (err) {
      console.error('summary: scheduler tick failed:', err && err.code ? err.code : (err && err.message) || err);
    } finally {
      ticking = false;
    }
    drain();
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { dueDeliveries, startScheduler, CATCH_UP_WINDOW_MS };
