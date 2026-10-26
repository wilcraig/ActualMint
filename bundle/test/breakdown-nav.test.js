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

test('drilling into a payee slice at level payees is a no-op (leaf level)', () => {
  const payeesState = initialState(OPEN);
  const drilled = drillInto(payeesState, { id: 'payeeX', label: 'Trader Joes' });
  expect(drilled).toEqual(payeesState);
});

test('clicking the same slice twice from the same state produces the same resulting state (no duplicate history)', () => {
  const groupsState = zoomOut(zoomOut(initialState(OPEN)));
  const first = drillInto(groupsState, { id: 'group2', label: 'Housing' });
  const second = drillInto(groupsState, { id: 'group2', label: 'Housing' });
  expect(second).toEqual(first);
});
