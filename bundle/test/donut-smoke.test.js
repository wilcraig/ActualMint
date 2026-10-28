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

test('showLegend defaults to true (the drill-down modal keeps its legend)', () => {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new CategoryBreakdownDonut({
    target,
    props: { slices: [{ id: 'a', label: 'Groceries', amountCents: 300 }], total: 300 },
  });
  expect(target.querySelector('.donut-legend')).not.toBeNull();
});

test('showLegend=false hides the legend list (the standalone main-reports-page donut)', () => {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new CategoryBreakdownDonut({
    target,
    props: { slices: [{ id: 'a', label: 'Groceries', amountCents: 300 }], total: 300, showLegend: false },
  });
  expect(target.querySelector('.donut-legend')).toBeNull();
  // The total figure is not part of "the legend" and stays either way.
  expect(target.querySelector('.donut-total')).not.toBeNull();
});

test('hovering a slice shows its label and amount in the donut center; leaving clears it', async () => {
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new CategoryBreakdownDonut({
    target,
    props: {
      slices: [{ id: 'a', label: 'Groceries', amountCents: 300 }],
      total: 300,
      showLegend: false,
    },
  });

  expect(target.querySelector('.donut-center-label')).toBeNull();

  const path = target.querySelector('path.donut-slice');
  path.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await Promise.resolve();
  expect(target.querySelector('.donut-center-label').textContent).toBe('Groceries');
  expect(target.querySelector('.donut-center-amount').textContent).toBe('$3.00');

  path.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  await Promise.resolve();
  expect(target.querySelector('.donut-center-label')).toBeNull();
});

test('a long-press (touchstart held past the threshold) shows the center label; touchend clears it', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="host"></div>';
  const target = document.getElementById('host');
  new CategoryBreakdownDonut({
    target,
    props: {
      slices: [{ id: 'a', label: 'Groceries', amountCents: 300 }],
      total: 300,
      showLegend: false,
    },
  });

  const path = target.querySelector('path.donut-slice');
  path.dispatchEvent(new Event('touchstart', { bubbles: true }));

  // A touch released before the long-press threshold never reveals the label.
  await vi.advanceTimersByTimeAsync(200);
  expect(target.querySelector('.donut-center-label')).toBeNull();

  await vi.advanceTimersByTimeAsync(300);
  expect(target.querySelector('.donut-center-label').textContent).toBe('Groceries');

  path.dispatchEvent(new Event('touchend', { bubbles: true }));
  await Promise.resolve();
  expect(target.querySelector('.donut-center-label')).toBeNull();

  vi.useRealTimers();
});
