import { WIDGET_REGISTRY } from '../../src/widget-builder/registry';

test('registers pacing-bars with its categoryIds field, and nothing unimplemented', () => {
  expect(WIDGET_REGISTRY).toEqual([
    { id: 'pacing-bars', label: 'Pacing bars', fields: [
      { key: 'categoryIds', type: 'category-multiselect', label: 'Categories' },
    ] },
  ]);
});
