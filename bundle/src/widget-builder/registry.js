// Widget types the widget-builder panel can configure. Only widgets with a
// mount.js consumer belong here; add an entry in the PR that implements the widget.
export const WIDGET_REGISTRY = [
  {
    id: 'pacing-bars',
    label: 'Pacing bars',
    fields: [
      { key: 'categoryIds', type: 'category-multiselect', label: 'Categories' },
    ],
  },
  {
    id: 'month-end-net',
    label: 'Projected month-end net',
    fields: [],
  },
  {
    id: 'paycheck-alerts',
    label: 'Paycheck alerts (3-paycheck months)',
    fields: [],
  },
  {
    id: 'bills-timeline',
    label: 'Bills / autopay timeline',
    fields: [],
  },
  {
    id: 'account-balances',
    label: 'Account balances chart',
    fields: [
      { key: 'accountIds', type: 'account-multiselect', label: 'Accounts' },
    ],
  },
];
