import { initialState, drillInto, zoomOut } from '../src/widgets/breakdown-nav';

const OPEN = { categoryId: 'catA', categoryName: 'Groceries', groupId: 'group1', groupName: 'Everyday Expenses' };

test('starts at level 3 (payees) for the clicked category', () => {
  const state = initialState(OPEN);
  expect(state).toMatchObject({
    level: 'payees',
    categoryId: 'catA',
    categoryName: 'Groceries',
    groupId: 'group1',
    groupName: 'Everyday Expenses',
  });
});

test('zooming out from payees goes to categories in the same group', () => {
  const state = initialState(OPEN);
  const zoomed = zoomOut(state);
  expect(zoomed).toMatchObject({ level: 'categories', groupId: 'group1', groupName: 'Everyday Expenses' });
});

test('zooming out from categories goes to groups', () => {
  const state = zoomOut(zoomOut(initialState(OPEN)));
  expect(state).toMatchObject({ level: 'groups' });
});

test('zooming out from groups is a no-op (stays at groups)', () => {
  const state = zoomOut(zoomOut(zoomOut(initialState(OPEN))));
  expect(state).toMatchObject({ level: 'groups' });
});

test('drilling into a group slice at level groups moves to categories for that group', () => {
  const groupsState = zoomOut(zoomOut(initialState(OPEN)));
  const drilled = drillInto(groupsState, { id: 'group2', label: 'Housing' });
  expect(drilled).toMatchObject({ level: 'categories', groupId: 'group2', groupName: 'Housing' });
});

test('drilling into a category slice at level categories moves to payees for that category', () => {
  const categoriesState = zoomOut(initialState(OPEN));
  const drilled = drillInto(categoriesState, { id: 'catB', label: 'Dining' });
  expect(drilled).toMatchObject({ level: 'payees', categoryId: 'catB', categoryName: 'Dining', groupId: 'group1' });
});

test('drilling into a payee slice at level payees moves to transactions for that payee', () => {
  const payeesState = initialState(OPEN);
  const drilled = drillInto(payeesState, { id: 'payeeX', label: 'Trader Joes' });
  expect(drilled).toMatchObject({
    level: 'transactions',
    categoryId: 'catA',
    categoryName: 'Groceries',
    payeeId: 'payeeX',
    payeeName: 'Trader Joes',
  });
});

test('drilling into a transaction slice at level transactions is a no-op (leaf level)', () => {
  const transactionsState = drillInto(initialState(OPEN), { id: 'payeeX', label: 'Trader Joes' });
  const drilled = drillInto(transactionsState, { id: 't1', label: 'irrelevant' });
  expect(drilled).toEqual(transactionsState);
});

test('zooming out from transactions goes back to payees for the same category', () => {
  const transactionsState = drillInto(initialState(OPEN), { id: 'payeeX', label: 'Trader Joes' });
  const zoomed = zoomOut(transactionsState);
  expect(zoomed).toMatchObject({ level: 'payees', categoryId: 'catA', categoryName: 'Groceries' });
});

test('clicking the same slice twice from the same state produces the same resulting state (no duplicate history)', () => {
  const groupsState = zoomOut(zoomOut(initialState(OPEN)));
  const first = drillInto(groupsState, { id: 'group2', label: 'Housing' });
  const second = drillInto(groupsState, { id: 'group2', label: 'Housing' });
  expect(second).toEqual(first);
});

describe('rollup entry (a PacingBars rollup bar, scoped to an arbitrary category id list)', () => {
  const ROLLUP_OPEN = { categoryIds: ['catA', 'catB', 'catC'], rollupTitle: 'Elizabeth Personal Care' };

  test('starts at level categories, scoped to the rollup\'s member categories', () => {
    const state = initialState(ROLLUP_OPEN);
    expect(state).toMatchObject({ level: 'categories', categoryIds: ['catA', 'catB', 'catC'], groupName: 'Elizabeth Personal Care' });
  });

  test('drilling into one of the rollup\'s categories moves to payees for it, keeping categoryIds as sticky context', () => {
    const drilled = drillInto(initialState(ROLLUP_OPEN), { id: 'catA', label: 'Botox' });
    expect(drilled).toMatchObject({ level: 'payees', categoryId: 'catA', categoryName: 'Botox', categoryIds: ['catA', 'catB', 'catC'] });
  });

  test('zooming out from that payees view returns to the SAME rollup\'s categories, not a real group', () => {
    const payeesState = drillInto(initialState(ROLLUP_OPEN), { id: 'catA', label: 'Botox' });
    const zoomed = zoomOut(payeesState);
    expect(zoomed).toMatchObject({ level: 'categories', categoryIds: ['catA', 'catB', 'catC'], groupName: 'Elizabeth Personal Care' });
  });

  test('drilling all the way to transactions and back still carries the rollup context', () => {
    let state = initialState(ROLLUP_OPEN);
    state = drillInto(state, { id: 'catA', label: 'Botox' });
    state = drillInto(state, { id: 'payeeX', label: 'Spa Co' });
    expect(state).toMatchObject({ level: 'transactions', categoryIds: ['catA', 'catB', 'catC'], categoryId: 'catA', payeeId: 'payeeX' });

    state = zoomOut(zoomOut(state));
    expect(state).toMatchObject({ level: 'categories', categoryIds: ['catA', 'catB', 'catC'] });
  });
});

describe('group-filtered entry (a standalone "pick your own groups" donut widget)', () => {
  const GROUPS_OPEN = { groupIds: ['group1', 'group2'] };

  test('starts at level groups, scoped to the curated group id list', () => {
    const state = initialState(GROUPS_OPEN);
    expect(state).toMatchObject({ level: 'groups', groupIds: ['group1', 'group2'] });
  });

  test('zooming out from groups is still a no-op, preserving the curated list', () => {
    const state = zoomOut(initialState(GROUPS_OPEN));
    expect(state).toMatchObject({ level: 'groups', groupIds: ['group1', 'group2'] });
  });

  test('drilling into one of the curated groups and back preserves groupIds as sticky context', () => {
    const categoriesState = drillInto(initialState(GROUPS_OPEN), { id: 'group1', label: 'Shopping' });
    expect(categoriesState).toMatchObject({ level: 'categories', groupId: 'group1', groupName: 'Shopping', groupIds: ['group1', 'group2'] });

    const backToGroups = zoomOut(categoriesState);
    expect(backToGroups).toMatchObject({ level: 'groups', groupIds: ['group1', 'group2'] });
  });
});
