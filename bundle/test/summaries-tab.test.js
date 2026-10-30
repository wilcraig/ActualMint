vi.mock('../src/insights-page/summaries-api', async (importOriginal) => ({
  ...(await importOriginal()),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  previewSummary: vi.fn(),
  sendSummary: vi.fn(),
  getHistory: vi.fn(),
  getOptions: vi.fn(),
  getCategories: vi.fn(),
  getChannels: vi.fn(),
}));

import {
  getSettings,
  saveSettings,
  previewSummary,
  sendSummary,
  getHistory,
  getOptions,
  getCategories,
  getChannels,
  SummariesApiError,
} from '../src/insights-page/summaries-api';
import SummariesTab from '../src/insights-page/SummariesTab.svelte';

const SECTIONS = [
  { id: 'pacing', title: 'Pacing' },
  { id: 'largest', title: 'Largest transactions' },
  { id: 'upcoming', title: 'Coming up' },
  { id: 'watched', title: 'Watched categories' },
  { id: 'alerts', title: 'Over budget' },
];

function settings() {
  return {
    sections: {
      pacing: { enabled: true, tolerancePct: 10, categoryIds: [] },
      largest: { enabled: true, count: 5, minAmountCents: 0, excludeScheduled: true },
      upcoming: { enabled: true, lookAheadDays: 7, minAmountCents: 0 },
      watched: { enabled: false, categoryIds: [] },
      alerts: { enabled: false, categoryIds: [] },
    },
    exclusions: { categoryIds: ['c-mortgage'], payeeIds: [], scheduleIds: [] },
    failureChannelId: null,
    deliveries: [
      { id: 'd1', name: 'Week in Review', enabled: true, channelId: 'c1', period: 'week', schedule: { days: [0], times: ['07:00'] } },
    ],
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function type(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function change(el, value) {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function click(el) {
  el.click();
  await flush();
}

let timezone;
async function mountTab() {
  document.body.innerHTML = '<div id="host"></div>';
  new SummariesTab({ target: document.getElementById('host') });
  await flush();
  await flush();
  return document.getElementById('host');
}

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  timezone = BROWSER_TZ;
  getSettings.mockReset();
  getSettings.mockImplementation(async () => ({ settings: settings(), sections: SECTIONS, timezone }));
  saveSettings.mockReset();
  saveSettings.mockImplementation(async (s) => ({ settings: s }));
  previewSummary.mockReset();
  sendSummary.mockReset();
  getHistory.mockReset();
  getHistory.mockResolvedValue({ history: [{ at: '2026-10-29T13:00:00.000Z', deliveryId: 'd1', deliveryName: 'Week in Review', ok: false, error: 'Gmail: authentication failed', trigger: 'schedule' }] });
  getOptions.mockReset();
  getOptions.mockResolvedValue({ payees: [{ id: 'p1', name: 'Landlord' }], schedules: [{ id: 's1', name: 'Mortgage' }] });
  getCategories.mockReset();
  getCategories.mockResolvedValue({
    categories: [
      { id: 'c-groc', name: 'Groceries', groupName: 'Food' },
      { id: 'c-dining', name: 'Dining', groupName: 'Food' },
      { id: 'c-mortgage', name: 'Mortgage', groupName: 'Home' },
    ],
  });
  getChannels.mockReset();
  getChannels.mockResolvedValue({ channels: [{ id: 'c1', name: 'Phone', type: 'ntfy' }, { id: 'c2', name: 'Agent', type: 'webhook' }], types: [] });
});

test('renders a block per section from the registry list, in order', async () => {
  const host = await mountTab();
  const titles = [...host.querySelectorAll('.summary-section .section-name')].map((el) => el.textContent.trim());
  expect(titles).toEqual(['Pacing', 'Largest transactions', 'Coming up', 'Watched categories', 'Over budget']);
});

test('the period button group is pick-one with the four labels', async () => {
  const host = await mountTab();
  const buttons = [...host.querySelectorAll('[data-delivery-id="d1"] .period-group button')];
  expect(buttons.map((b) => b.textContent.trim())).toEqual([
    'Yesterday',
    'Week in Review',
    'New Since Last Summary',
    'Month-to-date, highlighting This Week',
  ]);
  expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim())).toEqual(['Week in Review']);
  await click(buttons[2]);
  const after = [...host.querySelectorAll('[data-delivery-id="d1"] .period-group button')];
  expect(after.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim())).toEqual(['New Since Last Summary']);
});

test('editing days, times, channel and section settings saves a payload validateSettings accepts', async () => {
  const host = await mountTab();
  const card = () => host.querySelector('[data-delivery-id="d1"]');
  expect(host.querySelector('.unsaved-indicator')).toBeNull();

  const wed = card().querySelector('.day-checkbox[data-day="3"]');
  wed.checked = true;
  change(wed);
  await flush();
  await click(card().querySelector('.add-time'));
  const times = card().querySelectorAll('.time-input');
  expect(times).toHaveLength(2);
  type(times[1], '18:30');
  change(card().querySelector('.channel-select'), 'c2');
  await click(card().querySelectorAll('.period-group button')[0]);

  type(host.querySelector('#summary-largest-count'), '3');
  type(host.querySelector('#summary-largest-min'), '25.50');
  type(host.querySelector('#summary-pacing-tolerance'), '15');
  await flush();
  expect(host.querySelector('.unsaved-indicator')).not.toBeNull();

  await click(host.querySelector('.save-settings'));
  const saved = saveSettings.mock.calls[0][0];
  expect(saved.deliveries).toEqual([
    { id: 'd1', name: 'Week in Review', enabled: true, channelId: 'c2', period: 'yesterday', schedule: { days: [0, 3], times: ['07:00', '18:30'] } },
  ]);
  expect(saved.sections.largest).toEqual({ enabled: true, count: 3, minAmountCents: 2550, excludeScheduled: true });
  expect(saved.sections.pacing.tolerancePct).toBe(15);
  expect(Object.keys(saved)).toEqual(['sections', 'exclusions', 'failureChannelId', 'deliveries']);
  await flush();
  expect(host.querySelector('.unsaved-indicator')).toBeNull();
});

test('removing a time and adding a new delivery', async () => {
  const host = await mountTab();
  await click(host.querySelector('[data-delivery-id="d1"] .remove-time'));
  await click(host.querySelector('.add-delivery'));
  const cards = host.querySelectorAll('.delivery-card');
  expect(cards).toHaveLength(2);
  type(cards[1].querySelector('.delivery-name'), 'Daily');
  await click(host.querySelector('.save-settings'));
  const saved = saveSettings.mock.calls[0][0];
  expect(saved.deliveries[0].schedule.times).toEqual([]);
  expect(saved.deliveries[1]).toMatchObject({ name: 'Daily', enabled: true, channelId: null, period: 'yesterday', schedule: { days: [0, 1, 2, 3, 4, 5, 6], times: ['07:00'] } });
  expect(typeof saved.deliveries[1].id).toBe('string');
  expect(saved.deliveries[1].id).not.toBe('d1');
});

test('an API validation error is shown by its field', async () => {
  saveSettings.mockRejectedValue(new SummariesApiError('times must be HH:MM (24-hour)', 'deliveries[0].schedule.times'));
  const host = await mountTab();
  await click(host.querySelector('.save-settings'));
  const error = host.querySelector('[data-delivery-id="d1"] .field-error');
  expect(error.textContent).toBe('times must be HH:MM (24-hour)');
  expect(host.querySelector('.unsaved-indicator')).toBeNull();
});

test('Preview opens with the returned text, for the draft delivery and settings', async () => {
  previewSummary.mockResolvedValue({
    message: { title: 'Budget summary: Week in Review', text: 'Week in Review: 2026-10-22 to 2026-10-28\n\nPacing\n- On track', markdown: '**x**', html: '<p>x</p>', data: { schemaVersion: 1 } },
  });
  const host = await mountTab();
  await click(host.querySelector('[data-delivery-id="d1"] .preview-button'));
  await flush();
  const dialog = host.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain('Budget summary: Week in Review');
  expect(dialog.querySelector('.preview-body').textContent).toContain('- On track');
  const body = previewSummary.mock.calls[0][0];
  expect(body.delivery.id).toBe('d1');
  expect(body.settings.sections.largest.count).toBe(5);

  await click(dialog.querySelector('.preview-format-json'));
  expect(host.querySelector('.preview-body').textContent).toContain('"schemaVersion": 1');
  await click(host.querySelector('.preview-close'));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

test('Send now shows the error from the API', async () => {
  sendSummary.mockResolvedValue({ ok: false, error: 'Gmail: authentication failed' });
  const host = await mountTab();
  await click(host.querySelector('[data-delivery-id="d1"] .send-button'));
  await flush();
  expect(sendSummary).toHaveBeenCalledWith('d1');
  expect(host.querySelector('[data-delivery-id="d1"] .send-result').textContent).toContain('Gmail: authentication failed');
});

test('Send now shows a tick on success and refreshes history', async () => {
  sendSummary.mockResolvedValue({ ok: true });
  const host = await mountTab();
  await click(host.querySelector('[data-delivery-id="d1"] .send-button'));
  await flush();
  expect(host.querySelector('[data-delivery-id="d1"] .send-result').textContent).toContain('✓');
  expect(getHistory).toHaveBeenCalledTimes(2);
});

test('Send now is disabled while there are unsaved changes', async () => {
  const host = await mountTab();
  type(host.querySelector('[data-delivery-id="d1"] .delivery-name'), 'Renamed');
  await flush();
  expect(host.querySelector('[data-delivery-id="d1"] .send-button').disabled).toBe(true);
});

test('a watched category that is also excluded gets a note', async () => {
  const host = await mountTab();
  expect(host.querySelector('.overlap-note')).toBeNull();
  const watchedAdd = host.querySelector('#summary-watched-categories .picker-add');
  change(watchedAdd, 'c-mortgage');
  await flush();
  const note = host.querySelector('.overlap-note');
  expect(note).not.toBeNull();
  expect(note.textContent).toContain('Mortgage');
});

test('exclusion pickers list categories, payees and schedules', async () => {
  const host = await mountTab();
  expect(host.querySelector('#summary-exclude-categories .picker-chip').textContent).toContain('Mortgage');
  change(host.querySelector('#summary-exclude-payees .picker-add'), 'p1');
  change(host.querySelector('#summary-exclude-schedules .picker-add'), 's1');
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings.mock.calls[0][0].exclusions).toEqual({ categoryIds: ['c-mortgage'], payeeIds: ['p1'], scheduleIds: ['s1'] });
});

test('failure alerts channel picker', async () => {
  const host = await mountTab();
  change(host.querySelector('#summary-failure-channel'), 'c2');
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings.mock.calls[0][0].failureChannelId).toBe('c2');
});

test('the time-zone warning appears only when the zones differ', async () => {
  let host = await mountTab();
  expect(host.querySelector('.timezone').textContent).toContain(BROWSER_TZ);
  expect(host.querySelector('.timezone-warning')).toBeNull();

  timezone = BROWSER_TZ === 'Pacific/Chatham' ? 'Asia/Kolkata' : 'Pacific/Chatham';
  host = await mountTab();
  expect(host.querySelector('.timezone-warning')).not.toBeNull();
});

test('send history shows when, delivery, outcome and error', async () => {
  const host = await mountTab();
  const row = host.querySelector('.history-row');
  expect(row.textContent).toContain('Week in Review');
  expect(row.textContent).toContain('✗');
  expect(row.textContent).toContain('Gmail: authentication failed');
});

test('a load failure is shown', async () => {
  getSettings.mockRejectedValue(new SummariesApiError('Could not reach insights-api.'));
  const host = await mountTab();
  expect(host.textContent).toContain('Could not reach insights-api.');
});
