vi.mock('../src/insights-page/forecast-api', async (importOriginal) => ({
  ...(await importOriginal()),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  checkNow: vi.fn(),
  sendTestMessage: vi.fn(),
  getHistory: vi.fn(),
}));
vi.mock('../src/insights-page/summaries-api', async (importOriginal) => ({
  ...(await importOriginal()),
  getChannels: vi.fn(),
}));

import { getSettings, saveSettings, checkNow, sendTestMessage, getHistory, ForecastApiError } from '../src/insights-page/forecast-api';
import { getChannels } from '../src/insights-page/summaries-api';
import ForecastTab from '../src/insights-page/ForecastTab.svelte';

function settings(over = {}) {
  return { enabled: false, windowDays: 15, time: '07:00', channelId: null, accounts: {}, ...over };
}

const ACCOUNTS = [
  { id: 'a1', name: 'Checking', balanceCents: 123456 },
  { id: 'a2', name: 'Savings', balanceCents: 500000 },
];

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

async function mountTab() {
  document.body.innerHTML = '<div id="host"></div>';
  new ForecastTab({ target: document.getElementById('host') });
  await flush();
  await flush();
  return document.getElementById('host');
}

const row = (host, id) => host.querySelector(`[data-account-id="${id}"].account-row`);
const toggle = (host, id) => row(host, id).querySelector('.account-toggle');

beforeEach(() => {
  getSettings.mockReset();
  getSettings.mockImplementation(async () => ({ settings: settings(), accounts: ACCOUNTS, timezone: 'America/New_York' }));
  saveSettings.mockReset();
  saveSettings.mockImplementation(async (s) => ({ settings: s }));
  checkNow.mockReset();
  sendTestMessage.mockReset();
  getHistory.mockReset();
  getHistory.mockResolvedValue({ history: [{ at: '2026-10-29T13:00:00.000Z', ok: true, trigger: 'schedule', warned: ['a1'] }] });
  getChannels.mockReset();
  getChannels.mockResolvedValue({ channels: [{ id: 'c1', name: 'Phone', type: 'ntfy' }], types: [] });
});

test('renders a row per account with a switch and balance, warning field hidden until on', async () => {
  const host = await mountTab();
  const rows = host.querySelectorAll('.account-row');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Checking');
  expect(rows[0].textContent).toContain('$1,234.56');
  expect(toggle(host, 'a1').checked).toBe(false);
  expect(row(host, 'a1').querySelector('.warning-level')).toBeNull();
});

test('turning an account on reveals its warning level field defaulting to 0', async () => {
  const host = await mountTab();
  toggle(host, 'a1').checked = true;
  change(toggle(host, 'a1'));
  await flush();
  const field = row(host, 'a1').querySelector('.warning-level');
  expect(field).not.toBeNull();
  expect(field.value).toBe('0');
});

test('entering 25 saves warningLevelCents 2500 and sends the whole settings object', async () => {
  const host = await mountTab();
  toggle(host, 'a1').checked = true;
  change(toggle(host, 'a1'));
  await flush();
  type(row(host, 'a1').querySelector('.warning-level'), '25');
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings).toHaveBeenCalledTimes(1);
  expect(saveSettings).toHaveBeenCalledWith({
    enabled: false,
    windowDays: 15,
    time: '07:00',
    channelId: null,
    accounts: { a1: { enabled: true, warningLevelCents: 2500 } },
  });
});

test('a negative or non-numeric warning level is rejected before sending', async () => {
  const host = await mountTab();
  toggle(host, 'a1').checked = true;
  change(toggle(host, 'a1'));
  await flush();
  type(row(host, 'a1').querySelector('.warning-level'), '-5');
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings).not.toHaveBeenCalled();
  expect(host.querySelector('.save-error').textContent).toContain('Warning level');
  type(row(host, 'a1').querySelector('.warning-level'), '10');
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings).toHaveBeenCalledTimes(1);
  expect(saveSettings.mock.calls[0][0].accounts.a1.warningLevelCents).toBe(1000);
});

test('shows the API error next to windowDays', async () => {
  saveSettings.mockRejectedValue(new ForecastApiError('must be a whole number from 1 to 30', 'windowDays'));
  const host = await mountTab();
  type(host.querySelector('#forecast-window-days'), '99');
  await flush();
  await click(host.querySelector('.save-settings'));
  const err = host.querySelector('#forecast-window-days').closest('.form-row').querySelector('.field-error');
  expect(err.textContent).toContain('whole number from 1 to 30');
});

test('turning the daily check on with no channel shows the server error beside the channel', async () => {
  saveSettings.mockRejectedValue(new ForecastApiError('Pick a channel to turn on the daily check', 'channelId'));
  const host = await mountTab();
  const enabled = host.querySelector('#forecast-enabled');
  enabled.checked = true;
  change(enabled);
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings.mock.calls[0][0]).toMatchObject({ enabled: true, channelId: null });
  const err = host.querySelector('#forecast-channel').closest('.form-row').querySelector('.field-error');
  expect(err.textContent).toContain('Pick a channel to turn on the daily check');
});

test('Check now shows a warning line for a breach and No shortfall otherwise, with lowest and allowance note', async () => {
  getSettings.mockImplementation(async () => ({
    settings: settings({ accounts: { a1: { enabled: true, warningLevelCents: 0 }, a2: { enabled: true, warningLevelCents: 0 } } }),
    accounts: ACCOUNTS,
    timezone: null,
  }));
  checkNow.mockResolvedValue({
    forecast: {
      results: [
        {
          accountId: 'a1', accountName: 'Checking', warningLevelCents: 0, balanceCents: 123456, allowancePerDayCents: 1000,
          allowanceNote: null, days: [], events: [], lowest: { date: '2026-11-03', balanceCents: -4500 },
          breach: { date: '2026-11-03', balanceCents: -4500, shortfallCents: 4500, item: { name: 'Mortgage', amountCents: 200000 } },
        },
        {
          accountId: 'a2', accountName: 'Savings', warningLevelCents: 0, balanceCents: 500000, allowancePerDayCents: 0,
          allowanceNote: 'Not enough history for an everyday-spending allowance (needs 4 weeks).', days: [], events: [],
          lowest: { date: '2026-11-01', balanceCents: 499000 }, breach: null,
        },
      ],
      errors: [{ accountId: 'a3', accountName: 'Broken', error: 'could not read balance' }],
    },
  });
  const host = await mountTab();
  await click(host.querySelector('.check-now'));
  const r1 = host.querySelector('.forecast-result[data-account-id="a1"]');
  const r2 = host.querySelector('.forecast-result[data-account-id="a2"]');
  expect(r1.textContent).toContain('Checking');
  expect(r1.querySelector('.result-warning').textContent).toContain('2026-11-03');
  expect(r1.querySelector('.result-warning').textContent).toContain('Mortgage');
  expect(r1.textContent).toContain('Lowest');
  expect(r2.textContent).toContain('No shortfall in the next 15 days');
  expect(r2.textContent).toContain('needs 4 weeks');
  expect(host.querySelector('.forecast-errors').textContent).toContain('Broken');
});

function chartResult(id, name, over = {}) {
  return {
    accountId: id, accountName: name, warningLevelCents: 0, balanceCents: 100000, allowancePerDayCents: 0, allowanceNote: null,
    days: [{ date: '2026-11-01', balanceCents: 100000 }, { date: '2026-11-02', balanceCents: 90000 }],
    events: [{ date: '2026-11-02', name: `${name} bill`, amountCents: -10000 }],
    lowest: { date: '2026-11-02', balanceCents: 90000 }, breach: null, ...over,
  };
}

test('Check now draws one chart; with several accounts a picker switches it, defaulting to the first', async () => {
  getSettings.mockImplementation(async () => ({
    settings: settings({ accounts: { a1: { enabled: true, warningLevelCents: 0 }, a2: { enabled: true, warningLevelCents: 0 } } }),
    accounts: ACCOUNTS,
    timezone: null,
  }));
  checkNow.mockResolvedValue({ forecast: { results: [chartResult('a1', 'Checking'), chartResult('a2', 'Savings')], errors: [] } });
  const host = await mountTab();
  await click(host.querySelector('.check-now'));
  expect(host.querySelectorAll('.actualmint-forecast-chart svg')).toHaveLength(1);
  expect(host.querySelector('.actualmint-forecast-chart').textContent).toContain('Checking bill');
  // The per-account results lines stay.
  expect(host.querySelectorAll('.forecast-result')).toHaveLength(2);
  const picker = host.querySelector('.forecast-account-picker');
  expect(picker).not.toBeNull();
  expect(picker.value).toBe('a1');
  change(picker, 'a2');
  await flush();
  expect(host.querySelectorAll('.actualmint-forecast-chart svg')).toHaveLength(1);
  expect(host.querySelector('.actualmint-forecast-chart').textContent).toContain('Savings bill');
});

test('Check now with one account draws its chart without a picker', async () => {
  getSettings.mockImplementation(async () => ({
    settings: settings({ accounts: { a1: { enabled: true, warningLevelCents: 0 } } }),
    accounts: ACCOUNTS,
    timezone: null,
  }));
  checkNow.mockResolvedValue({ forecast: { results: [chartResult('a1', 'Checking')], errors: [] } });
  const host = await mountTab();
  await click(host.querySelector('.check-now'));
  expect(host.querySelectorAll('.actualmint-forecast-chart svg')).toHaveLength(1);
  expect(host.querySelector('.forecast-account-picker')).toBeNull();
});

test('Check now shows forecast.error when the preview failed', async () => {
  checkNow.mockResolvedValue({ forecast: { error: 'Actual is unreachable', results: [], errors: [] } });
  const host = await mountTab();
  await click(host.querySelector('.check-now'));
  expect(host.querySelector('.check-error').textContent).toContain('Actual is unreachable');
});

test('Check now shows a thrown error', async () => {
  checkNow.mockRejectedValue(new ForecastApiError('Could not reach insights-api.'));
  const host = await mountTab();
  await click(host.querySelector('.check-now'));
  expect(host.querySelector('.check-error').textContent).toContain('Could not reach insights-api.');
});

test('Send test is disabled with no channel; with one it shows Sent', async () => {
  const host = await mountTab();
  expect(host.querySelector('.send-test').disabled).toBe(true);

  getSettings.mockImplementation(async () => ({ settings: settings({ channelId: 'c1' }), accounts: ACCOUNTS, timezone: null }));
  sendTestMessage.mockResolvedValue({ ok: true });
  const host2 = await mountTab();
  expect(host2.querySelector('.send-test').disabled).toBe(false);
  await click(host2.querySelector('.send-test'));
  expect(host2.querySelector('.test-result').textContent).toContain('Sent');
});

test('Send test shows the error from a failed send', async () => {
  getSettings.mockImplementation(async () => ({ settings: settings({ channelId: 'c1' }), accounts: ACCOUNTS, timezone: null }));
  sendTestMessage.mockResolvedValue({ ok: false, error: 'ntfy: 403' });
  const host = await mountTab();
  await click(host.querySelector('.send-test'));
  expect(host.querySelector('.test-result').textContent).toContain('ntfy: 403');
});

test('the cc-helper note shows above 15 days and not at 15', async () => {
  const host = await mountTab();
  expect(host.querySelector('.cc-helper-note')).toBeNull();
  type(host.querySelector('#forecast-window-days'), '20');
  await flush();
  expect(host.querySelector('.cc-helper-note').textContent).toContain('cc-helper');
  type(host.querySelector('#forecast-window-days'), '15');
  await flush();
  expect(host.querySelector('.cc-helper-note')).toBeNull();
});

test('an unreachable API shows the error state without crashing', async () => {
  getSettings.mockRejectedValue(new ForecastApiError('Could not reach insights-api.'));
  const host = await mountTab();
  expect(host.querySelector('[role="alert"]').textContent).toContain('Could not reach insights-api.');
  expect(host.querySelector('.save-settings')).toBeNull();
});

test('shows the empty state when no accounts are on', async () => {
  const host = await mountTab();
  expect(host.textContent).toContain('Switch on an account above to see its forecast.');
});

test('check history says who was warned, Nothing to send, or the error', async () => {
  getHistory.mockResolvedValue({
    history: [
      { at: '2026-10-29T13:00:00.000Z', ok: true, trigger: 'schedule', warned: ['a1', 'a2'] },
      { at: '2026-10-28T13:00:00.000Z', ok: true, trigger: 'schedule', warned: [] },
      { at: '2026-10-27T13:00:00.000Z', ok: false, trigger: 'catch-up', warned: [], error: 'ntfy: 500' },
      { at: '2026-10-26T13:00:00.000Z', ok: true, trigger: 'schedule', warned: ['a1', 'gone'] },
    ],
  });
  const host = await mountTab();
  expect(host.textContent).toContain('Check history');
  expect(host.textContent).not.toContain('Send history');
  const rows = [...host.querySelectorAll('.history-row')].map((r) => r.children[1].textContent.trim());
  expect(rows[0]).toBe('Warned: Checking, Savings');
  expect(rows[1]).toBe('Nothing to send');
  expect(rows[2]).toContain('ntfy: 500');
  expect(rows[3]).toBe('Warned: 2 accounts');
});

test('empty check history says No checks yet.', async () => {
  getHistory.mockResolvedValue({ history: [] });
  const host = await mountTab();
  expect(host.textContent).toContain('No checks yet.');
});

async function turnOn(host, id) {
  toggle(host, id).checked = true;
  change(toggle(host, id));
  await flush();
  return row(host, id).querySelector('.warning-level');
}

test('typing decimals into the warning level is never rewritten, and saves exact cents', async () => {
  const host = await mountTab();
  const field = await turnOn(host, 'a1');
  for (const text of ['19.9', '19.99']) {
    type(field, text);
    await flush();
    expect(row(host, 'a1').querySelector('.warning-level').value).toBe(text);
  }
  await click(host.querySelector('.save-settings'));
  expect(saveSettings.mock.calls[0][0].accounts.a1.warningLevelCents).toBe(1999);
});

test('0.5 then 0.55 stays as typed and saves 55', async () => {
  const host = await mountTab();
  const field = await turnOn(host, 'a1');
  for (const text of ['0.5', '0.55']) {
    type(field, text);
    await flush();
    expect(field.value).toBe(text);
  }
  await click(host.querySelector('.save-settings'));
  expect(saveSettings.mock.calls[0][0].accounts.a1.warningLevelCents).toBe(55);
});

test('1e2 is accepted as 100 dollars; an empty field is rejected', async () => {
  const host = await mountTab();
  const field = await turnOn(host, 'a1');
  type(field, '1e2');
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings.mock.calls[0][0].accounts.a1.warningLevelCents).toBe(10000);
  saveSettings.mockClear();
  type(field, '');
  await flush();
  await click(host.querySelector('.save-settings'));
  expect(saveSettings).not.toHaveBeenCalled();
  expect(host.querySelector('.save-error').textContent).toContain('Warning level');
});

test('a loaded 2500 shows 25 and 1999 shows 19.99', async () => {
  getSettings.mockImplementation(async () => ({
    settings: settings({ accounts: { a1: { enabled: true, warningLevelCents: 2500 }, a2: { enabled: true, warningLevelCents: 1999 } } }),
    accounts: ACCOUNTS,
    timezone: null,
  }));
  const host = await mountTab();
  expect(row(host, 'a1').querySelector('.warning-level').value).toBe('25');
  expect(row(host, 'a2').querySelector('.warning-level').value).toBe('19.99');
});
