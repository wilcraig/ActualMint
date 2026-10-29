import { buildPlaceholder } from '../../src/widget-builder/placeholder';

test('a single-field widget emits the raw value, not a keyed object', () => {
  const result = buildPlaceholder(
    'pacing-bars',
    [{ key: 'categoryIds' }],
    { categoryIds: ['catA', 'catB'] }
  );
  expect(result).toBe('{{INSIGHTS:pacing-bars:["catA","catB"]}}');
});

test('a multi-field widget emits a keyed object', () => {
  const result = buildPlaceholder(
    'some-widget',
    [{ key: 'accountIds' }, { key: 'rangeMonths' }],
    { accountIds: ['acc1'], rangeMonths: 3 }
  );
  expect(result).toBe('{{INSIGHTS:some-widget:{"accountIds":["acc1"],"rangeMonths":3}}}');
});

test('a zero-field widget emits an empty object', () => {
  expect(buildPlaceholder('month-end-net', [], {})).toBe('{{INSIGHTS:month-end-net:{}}}');
});

test('a value needing JSON escaping round-trips through JSON.parse unchanged', () => {
  const id = 'cat"with\\quote';
  const result = buildPlaceholder('pacing-bars', [{ key: 'categoryIds' }], { categoryIds: [id] });
  const jsonBody = result.slice('{{INSIGHTS:pacing-bars:'.length, -'}}'.length);
  expect(JSON.parse(jsonBody)).toEqual([id]);
});
