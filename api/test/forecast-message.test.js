const { buildWarningMessage, buildTestMessage } = require('../src/forecast/message');
const { formatMoney } = require('../src/summary/format');

const warning = (over = {}) => ({
  accountId: 'a1',
  accountName: 'Checking',
  warningLevelCents: 50000,
  breach: {
    date: '2026-11-13',
    balanceCents: 45200,
    shortfallCents: 4800,
    item: { name: 'Mortgage', amountCents: 180000 },
  },
  lowest: { date: '2026-11-14', balanceCents: 30000 },
  allowancePerDayCents: 2500,
  allowanceNote: 'No spending history yet.',
  ...over,
});
const build = (warnings) =>
  buildWarningMessage({ warnings, windowDays: 15, generatedAt: '2026-10-30T12:00:00.000Z' });

test('one warning: title, text, data', () => {
  const m = build([warning()]);
  expect(m.title).toBe('Low balance warning: Checking');
  expect(m.text).toContain('Checking');
  expect(m.text).toContain('Nov 13');
  expect(m.text).toContain('Mortgage');
  expect(m.text).toContain(formatMoney(-180000));
  expect(m.text).toContain(formatMoney(4800));
  expect(m.text).toContain(formatMoney(30000));
  expect(m.text).toContain(`about ${formatMoney(2500)} a day`);
  expect(m.markdown).toContain('Checking');
  expect(m.data.schemaVersion).toBe(1);
  expect(m.data.event).toBe('cash-flow-warning');
  expect(m.data.generatedAt).toBe('2026-10-30T12:00:00.000Z');
  expect(m.data.windowDays).toBe(15);
  expect(m.data.accounts[0]).toEqual({
    accountId: 'a1',
    accountName: 'Checking',
    warningLevelCents: 50000,
    firstDate: '2026-11-13',
    shortfallCents: 4800,
    lowestCents: 30000,
    lowestDate: '2026-11-14',
    item: { name: 'Mortgage', amountCents: 180000 },
    allowancePerDayCents: 2500,
  });
});

test('two accounts appear in order', () => {
  const m = build([warning(), warning({ accountId: 'a2', accountName: 'Savings' })]);
  expect(m.title).toBe('Low balance warning: Checking, Savings');
  expect(m.text.indexOf('Checking')).toBeLessThan(m.text.indexOf('Savings'));
  expect(m.data.accounts.map((a) => a.accountId)).toEqual(['a1', 'a2']);
});

test('names are escaped in html and raw in data', () => {
  const m = build([warning({ accountName: '<b>x</b>' })]);
  expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  expect(m.html).not.toContain('<b>x</b>');
  expect(m.data.accounts[0].accountName).toBe('<b>x</b>');
});

test('null item reads everyday spending', () => {
  const m = build([warning({ breach: { ...warning().breach, item: null } })]);
  expect(m.text).toContain('everyday spending');
  expect(m.data.accounts[0].item).toBeNull();
});

test('zero allowance uses the note', () => {
  const m = build([warning({ allowancePerDayCents: 0 })]);
  expect(m.text).toContain('No spending history yet.');
  expect(m.text).not.toContain('a day');
});

test('gives no advice', () => {
  const m = build([warning(), warning({ allowancePerDayCents: 0 })]);
  expect(m.text).not.toMatch(/transfer|move/i);
});

test('test message', () => {
  const m = buildTestMessage();
  expect(m.title).toBe('Cash-flow check test');
  expect(m.text).toMatch(/test/i);
  expect(m.data.event).toBe('cash-flow-test');
});

test('zero allowance with no note omits the line', () => {
  const m = build([warning({ allowancePerDayCents: 0, allowanceNote: undefined })]);
  expect(m.text).not.toContain('undefined');
  expect(m.html).not.toContain('undefined');
});

test('item amount is Actual-signed: shown positive, raw in data', () => {
  const m = build([warning()]);
  expect(m.text).toContain('Mortgage ($1,800.00)');
  expect(m.text).not.toContain('-$1,800.00');
  expect(m.data.accounts[0].item.amountCents).toBe(-180000);
});
