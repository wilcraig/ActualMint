const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const { defaultSettings, readSettings, writeSettings, validateSettings } = require('../src/summary/settings-store');

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'summary-settings-test-'));
}

function delivery(overrides = {}) {
  return {
    id: 'd1',
    name: 'Week in Review',
    enabled: true,
    channelId: 'c1',
    period: 'week',
    schedule: { days: [0], times: ['07:00'] },
    ...overrides,
  };
}

function withSettings(mutate) {
  const settings = defaultSettings();
  mutate(settings);
  return settings;
}

test('defaults when the file does not exist', async () => {
  const dir = await tmpDir();
  expect(await readSettings(dir)).toEqual(defaultSettings());
});

test('defaults have every section and the documented values', () => {
  const s = defaultSettings();
  expect(s.sections.pacing).toEqual({ enabled: true, tolerancePct: 10, categoryIds: [] });
  expect(s.sections.largest).toEqual({ enabled: true, count: 5, minAmountCents: 0, excludeScheduled: true });
  expect(s.sections.upcoming).toEqual({ enabled: true, lookAheadDays: 7, minAmountCents: 0 });
  expect(s.sections.watched).toEqual({ enabled: false, categoryIds: [] });
  expect(s.sections.alerts).toEqual({ enabled: false, categoryIds: [] });
  expect(s.exclusions).toEqual({ categoryIds: [], payeeIds: [], scheduleIds: [] });
  expect(s.failureChannelId).toBeNull();
  expect(s.deliveries).toEqual([]);
});

test('a partial stored file is merged over the defaults so new keys appear', async () => {
  const dir = await tmpDir();
  await fs.writeFile(
    path.join(dir, 'summary-settings.json'),
    JSON.stringify({ sections: { largest: { count: 3 } }, deliveries: [delivery()] })
  );
  const s = await readSettings(dir);
  expect(s.sections.largest).toEqual({ enabled: true, count: 3, minAmountCents: 0, excludeScheduled: true });
  expect(s.sections.pacing).toEqual(defaultSettings().sections.pacing);
  expect(s.exclusions).toEqual(defaultSettings().exclusions);
  expect(s.deliveries).toEqual([delivery()]);
});

test('write then read round-trips, leaving no temp file', async () => {
  const dir = await tmpDir();
  const s = withSettings((x) => {
    x.deliveries = [delivery()];
    x.failureChannelId = 'c2';
    x.exclusions.categoryIds = ['cat-mortgage'];
  });
  await writeSettings(s, dir);
  expect(await readSettings(dir)).toEqual(s);
  expect(await fs.readdir(dir)).toEqual(['summary-settings.json']);
});

test('a corrupt file fails loudly', async () => {
  const dir = await tmpDir();
  await fs.writeFile(path.join(dir, 'summary-settings.json'), '{nope');
  await expect(readSettings(dir)).rejects.toThrow();
});

test('valid settings pass and come back normalized', () => {
  const s = withSettings((x) => {
    x.deliveries = [delivery({ schedule: { days: [3, 1, 1], times: ['18:30', '06:00'] } })];
  });
  const result = validateSettings(s);
  expect(result.ok).toBe(true);
  expect(result.settings.deliveries[0].schedule).toEqual({ days: [1, 3], times: ['06:00', '18:30'] });
});

test('partial input is filled from defaults', () => {
  const result = validateSettings({ sections: { largest: { count: 7 } } });
  expect(result.ok).toBe(true);
  expect(result.settings.sections.largest.count).toBe(7);
  expect(result.settings.sections.pacing.tolerancePct).toBe(10);
});

test.each([
  ['sections.pacing.enabled', (x) => { x.sections.pacing.enabled = 'yes'; }],
  ['sections.pacing.tolerancePct', (x) => { x.sections.pacing.tolerancePct = 101; }],
  ['sections.pacing.tolerancePct', (x) => { x.sections.pacing.tolerancePct = 2.5; }],
  ['sections.pacing.categoryIds', (x) => { x.sections.pacing.categoryIds = 'cat1'; }],
  ['sections.largest.count', (x) => { x.sections.largest.count = 0; }],
  ['sections.largest.count', (x) => { x.sections.largest.count = 26; }],
  ['sections.largest.minAmountCents', (x) => { x.sections.largest.minAmountCents = -1; }],
  ['sections.largest.excludeScheduled', (x) => { x.sections.largest.excludeScheduled = 1; }],
  ['sections.upcoming.lookAheadDays', (x) => { x.sections.upcoming.lookAheadDays = 0; }],
  ['sections.upcoming.lookAheadDays', (x) => { x.sections.upcoming.lookAheadDays = 61; }],
  ['sections.watched.categoryIds', (x) => { x.sections.watched.categoryIds = [1]; }],
  ['exclusions.payeeIds', (x) => { x.exclusions.payeeIds = null; }],
  ['failureChannelId', (x) => { x.failureChannelId = 5; }],
  ['deliveries', (x) => { x.deliveries = {}; }],
  ['deliveries', (x) => { x.deliveries = Array.from({ length: 21 }, (_, i) => delivery({ id: `d${i}` })); }],
  ['deliveries[0].id', (x) => { x.deliveries = [delivery({ id: '' })]; }],
  ['deliveries[1].id', (x) => { x.deliveries = [delivery(), delivery()]; }],
  ['deliveries[0].name', (x) => { x.deliveries = [delivery({ name: '  ' })]; }],
  ['deliveries[0].enabled', (x) => { x.deliveries = [delivery({ enabled: 'true' })]; }],
  ['deliveries[0].channelId', (x) => { x.deliveries = [delivery({ channelId: 7 })]; }],
  ['deliveries[0].period', (x) => { x.deliveries = [delivery({ period: 'fortnight' })]; }],
  ['deliveries[0].schedule.days', (x) => { x.deliveries = [delivery({ schedule: { days: [7], times: [] } })]; }],
  ['deliveries[0].schedule.days', (x) => { x.deliveries = [delivery({ schedule: { days: [1.5], times: [] } })]; }],
  ['deliveries[0].schedule.times', (x) => { x.deliveries = [delivery({ schedule: { days: [1], times: ['24:00'] } })]; }],
  ['deliveries[0].schedule.times', (x) => { x.deliveries = [delivery({ schedule: { days: [1], times: ['7:00'] } })]; }],
  ['deliveries[0].schedule', (x) => { x.deliveries = [delivery({ schedule: null })]; }],
])('rejects bad %s', (field, mutate) => {
  const result = validateSettings(withSettings(mutate));
  expect(result.ok).toBe(false);
  expect(result.field).toBe(field);
  expect(typeof result.error).toBe('string');
});

test('a delivery with no days and no times is valid (send on demand only)', () => {
  const result = validateSettings(withSettings((x) => { x.deliveries = [delivery({ schedule: { days: [], times: [] } })]; }));
  expect(result.ok).toBe(true);
});

test('a delivery with no channel yet is valid', () => {
  const result = validateSettings(withSettings((x) => { x.deliveries = [delivery({ channelId: null })]; }));
  expect(result.ok).toBe(true);
});

test('rejects a non-object', () => {
  expect(validateSettings(null)).toMatchObject({ ok: false });
});
