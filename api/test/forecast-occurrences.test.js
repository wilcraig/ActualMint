const { forecastOccurrences, scheduledPayeeIdsByAccount } = require('../src/forecast/occurrences');

const monthly = (day) => ({ start: `2026-01-${day}`, frequency: 'monthly', interval: 1, patterns: [], skipWeekend: false, weekendSolveMode: 'after', endMode: 'never' });

function sched(id, extra = {}) {
  return { id, completed: false, amount: -5000, payee: 'p-a', account: 'a-chk', ...extra };
}

function stubClient(schedules) {
  return {
    getSchedules: jest.fn(async () => schedules),
    getRules: jest.fn(async () => []),
    getCategoryGroups: jest.fn(async () => []),
    aqlQuery: jest.fn(async () => ({ data: [{ id: 'p-a', name: 'Acme' }, { id: 'p-b', name: 'Bravo' }] })),
  };
}

const TODAY = '2026-10-16';

test('recurring schedule with next_date in the window appears on its day', async () => {
  const client = stubClient([sched('s1', { date: monthly('20'), next_date: '2026-10-20' })]);
  const items = await forecastOccurrences(client, { today: TODAY, windowDays: 10 });
  expect(items).toEqual([
    { scheduleId: 's1', name: 'Acme', payeeId: 'p-a', accountId: 'a-chk', date: '2026-10-20', amountCents: -5000, overdue: false },
  ]);
});

test('an in-window occurrence earlier than next_date is dropped (already posted)', async () => {
  const client = stubClient([sched('s1', { date: monthly('20'), next_date: '2026-11-20' })]);
  const items = await forecastOccurrences(client, { today: TODAY, windowDays: 10 });
  expect(items).toEqual([]);
});

test('an in-window occurrence equal to next_date is kept', async () => {
  const client = stubClient([sched('s1', { date: monthly('20'), next_date: '2026-10-20' })]);
  const items = await forecastOccurrences(client, { today: TODAY, windowDays: 10 });
  expect(items.map((i) => i.date)).toEqual(['2026-10-20']);
});

test('a schedule whose next_date is before today adds one overdue item on today', async () => {
  const client = stubClient([sched('s1', { name: 'Rent', date: monthly('13'), next_date: '2026-10-13' })]);
  const items = await forecastOccurrences(client, { today: TODAY, windowDays: 10 });
  expect(items).toEqual([
    { scheduleId: 's1', name: 'Rent', payeeId: 'p-a', accountId: 'a-chk', date: TODAY, amountCents: -5000, overdue: true },
  ]);
});

test('completed schedules yield nothing', async () => {
  const client = stubClient([sched('s1', { completed: true, date: monthly('20'), next_date: '2026-10-13' })]);
  expect(await forecastOccurrences(client, { today: TODAY, windowDays: 10 })).toEqual([]);
});

test('one-time schedule inside the window appears, outside does not', async () => {
  const client = stubClient([
    sched('in', { date: '2026-10-18', next_date: '2026-10-18' }),
    sched('out', { date: '2026-11-30', next_date: '2026-11-30' }),
  ]);
  const items = await forecastOccurrences(client, { today: TODAY, windowDays: 10 });
  expect(items.map((i) => i.scheduleId)).toEqual(['in']);
});

test('the last day of the window is included for recurring schedules', async () => {
  const client = stubClient([sched('s1', { date: monthly('26'), next_date: '2026-10-26' })]);
  const items = await forecastOccurrences(client, { today: TODAY, windowDays: 10 });
  expect(items.map((i) => i.date)).toEqual(['2026-10-26']);
});

test('items are sorted by date, overdue first on today', async () => {
  const client = stubClient([
    sched('late', { date: '2026-10-25', next_date: '2026-10-25' }),
    sched('soon', { date: '2026-10-17', next_date: '2026-10-17' }),
    sched('over', { date: '2026-10-10', next_date: '2026-10-10' }),
  ]);
  const items = await forecastOccurrences(client, { today: TODAY, windowDays: 10 });
  expect(items.map((i) => [i.scheduleId, i.date])).toEqual([
    ['over', TODAY], ['soon', '2026-10-17'], ['late', '2026-10-25'],
  ]);
});

test('scheduledPayeeIdsByAccount skips completed schedules and groups by account', async () => {
  const client = stubClient([
    sched('s1', { payee: 'p-a', account: 'a-chk', date: '2026-10-18', next_date: '2026-10-18' }),
    sched('s2', { payee: 'p-b', account: 'a-chk', date: monthly('20'), next_date: '2026-10-20' }),
    sched('s3', { payee: 'p-b', account: 'a-sav', date: '2026-10-18', next_date: '2026-10-18' }),
    sched('s4', { payee: 'p-x', account: 'a-chk', completed: true, date: '2026-10-18', next_date: '2026-10-18' }),
  ]);
  const map = await scheduledPayeeIdsByAccount(client);
  expect([...map.keys()].sort()).toEqual(['a-chk', 'a-sav']);
  expect([...map.get('a-chk')].sort()).toEqual(['p-a', 'p-b']);
  expect([...map.get('a-sav')]).toEqual(['p-b']);
});
