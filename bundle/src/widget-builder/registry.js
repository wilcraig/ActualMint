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
];
