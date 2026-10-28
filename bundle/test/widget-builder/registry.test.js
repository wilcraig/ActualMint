import { WIDGET_REGISTRY } from '../../src/widget-builder/registry';

test('registers every widget with a mount.js consumer, and nothing unimplemented', () => {
  expect(WIDGET_REGISTRY).toEqual([
    { id: 'pacing-bars', label: 'Pacing bars', fields: [
      { key: 'categoryIds', type: 'category-multiselect', label: 'Categories' },
    ] },
    { id: 'month-end-net', label: 'Projected month-end net', fields: [] },
    { id: 'paycheck-alerts', label: 'Paycheck alerts (3-paycheck months)', fields: [] },
    { id: 'bills-timeline', label: 'Bills / autopay timeline', fields: [] },
    { id: 'account-balances', label: 'Account balances chart', fields: [
      { key: 'accountIds', type: 'account-multiselect', label: 'Accounts' },
    ] },
    { id: 'unlinked-transfers', label: 'Unlinked transfers (possible double-counted income/expense)', fields: [] },
  ]);
});
