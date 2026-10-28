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
      { key: 'labelContent', type: 'select', label: 'Combined-view band label', options: [
        { value: 'both', label: 'Balance + account name' },
        { value: 'amount', label: 'Balance only' },
        { value: 'name', label: 'Account name only' },
      ] },
    ] },
    { id: 'unlinked-transfers', label: 'Unlinked transfers (possible double-counted income/expense)', fields: [] },
    { id: 'spending-breakdown-donut', label: 'Spending breakdown donut', fields: [] },
    { id: 'savings-goals-thermometers', label: 'Sinking fund goals (thermometers)', fields: [
      { key: 'categoryIds', type: 'category-multiselect', label: 'Categories' },
    ] },
    { id: 'burn-rate', label: 'Cumulative burn rate (pacing slope)', fields: [] },
    { id: 'savings-rate-gauge', label: 'Net savings rate gauge', fields: [
      { key: 'investmentGroupIds', type: 'group-multiselect', label: 'Count as savings (not spending)', optional: true },
    ] },
    { id: 'spending-sankey', label: 'Monthly Sankey (Income → Group → Category)', fields: [] },
    { id: 'spending-treemap', label: 'Spending treemap', fields: [] },
    { id: 'subscription-radar', label: 'Subscription renewal radar', fields: [] },
    { id: 'spending-heatmap', label: 'Spending intensity calendar heatmap', fields: [
      { key: 'range', type: 'select', label: 'Range', options: [
        { value: 'month', label: 'Last 30 days' },
        { value: 'year', label: 'Last 12 months' },
      ] },
    ] },
  ]);
});
