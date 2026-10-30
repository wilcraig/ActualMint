const fs = require('fs/promises');
const path = require('path');
const os = require('os');

jest.mock('../src/summary/sections', () => {
  const make = (id, title) => ({ id, title, build: jest.fn() });
  const SECTIONS = [make('pacing', 'Pacing'), make('largest', 'Largest transactions'), make('upcoming', 'Coming up'), make('watched', 'Watched categories'), make('alerts', 'Over budget')];
  return { SECTIONS, getSection: (id) => SECTIONS.find((s) => s.id === id) };
});

const { SECTIONS } = require('../src/summary/sections');
const { buildSummary } = require('../src/summary/build-summary');
const { toMessage } = require('../src/summary/formatters');
const { defaultSettings } = require('../src/summary/settings-store');
const { appendHistory, markReported } = require('../src/summary/history-store');

const section = (id) => SECTIONS.find((s) => s.id === id);
const NOW = new Date(2026, 9, 29, 7, 0);
const DELIVERY = { id: 'd1', name: 'Week in Review', enabled: true, channelId: 'c1', period: 'week', schedule: { days: [0], times: ['07:00'] } };

const client = { getCategoryGroups: jest.fn(async () => []) };

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'summary-build-test-'));
}

let errorSpy;
beforeEach(() => {
  for (const s of SECTIONS) s.build.mockReset();
  section('pacing').build.mockResolvedValue({ data: { overall: { status: 'on-pace' } }, lines: ['On track: $812.00 spent, $890.00 expected by today'] });
  section('largest').build.mockResolvedValue({ data: { items: [{ id: 't1', amountCents: 4500 }] }, lines: ['2026-10-27 <Grocer> & Co: $45.00 (Groceries)'], reportedIds: ['t1'] });
  section('upcoming').build.mockResolvedValue({ data: { items: [], totalCents: 5000 }, lines: ['2026-10-30 Gym: $50.00', 'Total: $50.00'] });
  section('watched').build.mockResolvedValue({ data: { categories: [] }, lines: ['Dining: fine'] });
  section('alerts').build.mockResolvedValue(null);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

async function build({ settings = defaultSettings(), delivery = DELIVERY, dataDir } = {}) {
  return buildSummary({ client, now: NOW, delivery, settings, dataDir: dataDir || (await tmpDir()) });
}

test('sections run in registry order; disabled ones are skipped; null ones are left out', async () => {
  const { summary } = await build();
  expect(Object.keys(summary.sections)).toEqual(['pacing', 'largest', 'upcoming']);
  expect(section('watched').build).not.toHaveBeenCalled();
  const settings = defaultSettings();
  settings.sections.watched.enabled = true;
  settings.sections.alerts.enabled = true;
  settings.sections.largest.enabled = false;
  const second = await build({ settings });
  expect(Object.keys(second.summary.sections)).toEqual(['pacing', 'upcoming', 'watched']);
});

test('summary shape', async () => {
  const { summary, reportedIds } = await build();
  expect(Object.keys(summary)).toEqual(['schemaVersion', 'generatedAt', 'delivery', 'period', 'month', 'sections']);
  expect(summary.schemaVersion).toBe(1);
  expect(summary.generatedAt).toBe(NOW.toISOString());
  expect(summary.delivery).toEqual({ id: 'd1', name: 'Week in Review', period: 'week' });
  expect(summary.period).toEqual({ start: '2026-10-22', end: '2026-10-28' });
  expect(summary.month).toBe('2026-10');
  expect(summary.sections.pacing).toEqual({ title: 'Pacing', data: { overall: { status: 'on-pace' } }, lines: ['On track: $812.00 spent, $890.00 expected by today'] });
  expect(reportedIds).toEqual(['t1']);
});

test('one throwing section does not break the others', async () => {
  section('largest').build.mockRejectedValue(new Error('aql exploded'));
  const { summary, reportedIds } = await build();
  expect(summary.sections.largest).toEqual({ title: 'Largest transactions', data: null, error: 'could not be built' });
  expect(summary.sections.pacing.data).toBeTruthy();
  expect(summary.sections.upcoming.data).toBeTruthy();
  expect(reportedIds).toEqual([]);
});

test('the context carries the period from the last success and the reported ids', async () => {
  const dataDir = await tmpDir();
  await appendHistory({ at: new Date(2026, 9, 26, 7).toISOString(), deliveryId: 'd1', deliveryName: 'x', ok: true, trigger: 'schedule' }, dataDir);
  await markReported('d1', ['t-old'], NOW, dataDir);
  await build({ delivery: { ...DELIVERY, period: 'since-last' }, dataDir });
  const ctx = section('pacing').build.mock.calls[0][0];
  expect(ctx.period).toEqual({ kind: 'since-last', start: '2026-10-26', end: '2026-10-28' });
  expect(ctx.reportedIds).toEqual(new Set(['t-old']));
  expect(ctx.lastSentAt).toEqual(new Date(2026, 9, 26, 7));
});

describe('toMessage', () => {
  test('title, and every section title in text and markdown', async () => {
    const { summary } = await build();
    const message = toMessage(summary);
    expect(message.title).toBe('Budget summary: Week in Review');
    for (const title of ['Pacing', 'Largest transactions', 'Coming up']) {
      expect(message.text).toContain(title);
      expect(message.markdown).toContain(title);
      expect(message.html).toContain(title);
    }
    expect(message.text).toContain('On track: $812.00 spent, $890.00 expected by today');
    expect(message.text).toContain('2026-10-22 to 2026-10-28');
  });

  test('HTML escapes and has no scripts or external assets', async () => {
    const { summary } = await build();
    const { html } = toMessage(summary);
    expect(html).toContain('&lt;Grocer&gt; &amp; Co');
    expect(html).not.toContain('<Grocer>');
    expect(html).not.toMatch(/<script|<link|<img|src=|href=/i);
  });

  test('data is the versioned payload, with text and without lines', async () => {
    const { summary } = await build();
    const message = toMessage(summary);
    expect(Object.keys(message.data)).toEqual(['schemaVersion', 'generatedAt', 'delivery', 'period', 'month', 'text', 'sections']);
    expect(message.data.schemaVersion).toBe(1);
    expect(message.data.text).toBe(message.text);
    expect(message.data.sections.pacing).toEqual({ title: 'Pacing', data: { overall: { status: 'on-pace' } } });
    expect(JSON.stringify(message.data.sections)).not.toContain('"lines"');
  });

  test('a failed section is named in the text and the payload', async () => {
    section('largest').build.mockRejectedValue(new Error('x'));
    const { summary } = await build();
    const message = toMessage(summary);
    expect(message.text).toMatch(/Largest transactions\n.*could not be built/);
    expect(message.data.sections.largest).toEqual({ title: 'Largest transactions', data: null, error: 'could not be built' });
  });

  test('empty summary says Nothing to report.', async () => {
    for (const s of SECTIONS) s.build.mockResolvedValue(null);
    const { summary } = await build();
    const message = toMessage(summary);
    expect(summary.sections).toEqual({});
    expect(message.text).toContain('Nothing to report.');
    expect(message.markdown).toContain('Nothing to report.');
    expect(message.html).toContain('Nothing to report.');
  });
});
