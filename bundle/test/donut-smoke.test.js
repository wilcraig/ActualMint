import CategoryBreakdownDonut from '../src/widgets/CategoryBreakdownDonut.svelte';

test('renders empty-state message with no slices', () => {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new CategoryBreakdownDonut({ target, props: { slices: [], total: 0 } });
  expect(target.textContent).toContain('No spending to show.');
  expect(target.querySelector('svg')).toBeNull();
});

test('renders an svg donut with slices and fires onSliceClick', () => {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  const clicked = [];
  new CategoryBreakdownDonut({
    target,
    props: {
      slices: [
        { id: 'a', label: 'Groceries', amountCents: 300 },
        { id: 'b', label: 'Gas', amountCents: 100 },
      ],
      total: 400,
      onSliceClick: (id) => clicked.push(id),
    },
  });
  const paths = target.querySelectorAll('path.donut-slice');
  expect(paths.length).toBe(2);
  paths[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(clicked).toEqual(['a']);
});
