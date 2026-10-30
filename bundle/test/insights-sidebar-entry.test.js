import { mountSidebarEntry } from '../src/insights-page/sidebar-entry';

// Fixtures cut down from live markup (docs/insights-page-hosting-notes.md):
// Actual 26.10.0's own sidebar, and ABT 0.1.100's live sidebar in its
// Standard and Split (icon bar) layouts. Hashed class names are kept
// as-is so the entry is proven to clone them rather than know them.
const ICON = '<svg width="15" height="15" viewBox="0 0 20 20" style="color: inherit;"><path d="M0 0h20v20H0z" fill="currentColor"></path></svg>';

const NATIVE_SIDEBAR = `
  <div id="sidebar">
    <div data-testid="sidebar-primary-buttons" class="css-15mvrs5">
      <div class="css-15mvrs5"><a aria-current="page" class="css-7iovzr active" href="/budget"><div class="css-1myt2vd">${ICON}<div class="css-1isemmb">Budget</div><div class="css-1y7d8dh"></div></div></a></div>
      <div class="css-15mvrs5"><a class="css-1trtw0g" href="/reports"><div class="css-1myt2vd">${ICON}<div class="css-1isemmb">Reports</div><div class="css-1y7d8dh"></div></div></a></div>
      <div class="css-15mvrs5"><a class="css-1trtw0g" href="/schedules"><div class="css-1myt2vd">${ICON}<div class="css-1isemmb">Schedules</div><div class="css-1y7d8dh"></div></div></a></div>
      <div class="css-276q18"><button type="button">More</button></div>
      <div class="css-15mvrs5"><a class="css-e5dykp" href="/payees"><div class="css-7wcn6a">${ICON}<div class="css-1xh1wac">Payees</div></div></a></div>
      <div class="css-15mvrs5"><a class="css-e5dykp" href="/settings"><div class="css-7wcn6a">${ICON}<div class="css-1xh1wac">Settings</div></div></a></div>
    </div>
  </div>
`;

const LUCIDE = '<svg class="lucide lucide-chart-column lucide-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 3v16"></path></svg>';

const ABT_STANDARD = `
  <div class="sidebar transitions-ready" role="presentation">
    <nav class="nav svelte-1lvh2r">
      <button type="button" class="nav-link svelte-1lvh2r active"><span class="nav-icon svelte-1lvh2r">${LUCIDE}<!----></span> <span class="nav-label svelte-1lvh2r">Budget</span></button>
      <button type="button" class="nav-link svelte-1lvh2r"><span class="nav-icon svelte-1lvh2r">${LUCIDE}<!----></span> <span class="nav-label svelte-1lvh2r">Reports</span></button>
      <button type="button" class="nav-link svelte-1lvh2r"><span class="nav-icon svelte-1lvh2r">${LUCIDE}<!----></span> <span class="nav-label svelte-1lvh2r">Schedules</span></button>
      <!----> <!---->
      <button type="button" class="nav-link svelte-1lvh2r" aria-expanded="false"><span class="nav-icon svelte-1lvh2r">${LUCIDE}<!----></span> <span class="nav-label svelte-1lvh2r">Settings</span></button>
    </nav>
  </div>
`;

const ABT_SPLIT = `
  <div class="sidebar split transitions-ready" role="presentation">
    <div class="activity-bar">
      <button class="rail-avatar svelte-11repqg" aria-label="Change budget icon">TB</button>
      <div class="rail-nav svelte-11repqg">
        <button type="button" class="rail-icon svelte-11repqg active" aria-label="Budget">${LUCIDE}<!----></button>
        <button type="button" class="rail-icon svelte-11repqg" aria-label="Reports">${LUCIDE}<!----></button>
        <button type="button" class="rail-icon svelte-11repqg" aria-label="Schedules">${LUCIDE}<!----></button>
        <!----> <!---->
      </div>
      <div class="rail-divider svelte-11repqg"></div>
      <div class="rail-nav svelte-11repqg">
        <button type="button" class="rail-icon svelte-11repqg" aria-label="Payees">${LUCIDE}</button>
        <button type="button" class="rail-icon svelte-11repqg" aria-label="Settings">${LUCIDE}</button>
      </div>
    </div>
  </div>
`;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let unmount = null;

beforeEach(() => {
  window.history.replaceState(null, '', '/budget');
});

afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = '';
});

function entries() {
  return document.querySelectorAll('[data-insights-nav]');
}

function clickable(entry) {
  return entry.matches('a, button') ? entry : entry.querySelector('a, button');
}

const FIXTURES = [
  {
    name: 'Actual native sidebar',
    html: NATIVE_SIDEBAR,
    labelOf: (entry) => entry.textContent.trim(),
    after: (entry) => entry.previousElementSibling.querySelector('a').getAttribute('href') === '/schedules',
    budgetItem: () => document.querySelector('a[href="/budget"]'),
    isSelected: (el) => el.getAttribute('aria-current') === 'page',
  },
  {
    name: 'ABT live sidebar, Standard layout',
    html: ABT_STANDARD,
    labelOf: (entry) => entry.querySelector('.nav-label').textContent.trim(),
    after: (entry) => entry.previousElementSibling.textContent.trim() === 'Schedules',
    budgetItem: () => Array.from(document.querySelectorAll('.nav-link')).find((b) => b.textContent.trim() === 'Budget'),
    isSelected: (el) => el.classList.contains('active'),
  },
  {
    name: 'ABT live sidebar, Split layout',
    html: ABT_SPLIT,
    labelOf: (entry) => entry.getAttribute('aria-label'),
    after: (entry) => entry.previousElementSibling.getAttribute('aria-label') === 'Schedules',
    budgetItem: () => document.querySelector('[aria-label="Budget"]'),
    isSelected: (el) => el.classList.contains('active'),
  },
];

describe.each(FIXTURES)('$name', ({ html, labelOf, after, budgetItem, isSelected }) => {
  test('adds exactly one "Insights" entry, after Schedules, cloned from a sibling', async () => {
    document.body.innerHTML = html;
    unmount = mountSidebarEntry(document, window);
    await flush();

    expect(entries()).toHaveLength(1);
    const entry = entries()[0];
    expect(labelOf(entry)).toBe('Insights');
    expect(after(entry)).toBe(true);
    expect(entry.querySelector('svg') || entry.matches('svg')).toBeTruthy();
    expect(entry.textContent).not.toContain('Reports');
    // Not selected away from the page.
    expect(isSelected(clickable(entry))).toBe(false);
  });

  test('waits for the sidebar, and re-creates the entry when the sidebar is re-rendered', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    unmount = mountSidebarEntry(document, window);
    await flush();
    expect(entries()).toHaveLength(0);

    const root = document.getElementById('root');
    root.innerHTML = html;
    await flush();
    expect(entries()).toHaveLength(1);

    root.innerHTML = '';
    await flush();
    root.innerHTML = html;
    await flush();
    expect(entries()).toHaveLength(1);
  });

  test('unrelated DOM churn never duplicates the entry', async () => {
    document.body.innerHTML = html;
    unmount = mountSidebarEntry(document, window);
    await flush();

    for (let i = 0; i < 5; i += 1) {
      document.body.appendChild(document.createElement('span'));
      // Simulates a live-balance re-render inside the sidebar container.
      const container = entries()[0].parentElement;
      container.appendChild(document.createComment('x'));
      await flush();
    }
    expect(entries()).toHaveLength(1);
  });

  test('shows as selected only while the Insights page is open, and un-highlights the item underneath', async () => {
    document.body.innerHTML = html;
    unmount = mountSidebarEntry(document, window);
    await flush();
    const budget = budgetItem();
    expect(isSelected(budget)).toBe(true);

    window.history.pushState(null, '', '/budget#actual-insights');
    await flush();
    expect(isSelected(clickable(entries()[0]))).toBe(true);
    expect(isSelected(budget)).toBe(false);

    window.history.pushState(null, '', '/budget');
    await flush();
    expect(isSelected(clickable(entries()[0]))).toBe(false);
    expect(isSelected(budget)).toBe(true);
  });

  test('clicking the entry opens the page in place, without a page load', async () => {
    document.body.innerHTML = html;
    unmount = mountSidebarEntry(document, window);
    await flush();
    const pushSpy = vi.spyOn(window.history, 'pushState');

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    clickable(entries()[0]).dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(pushSpy).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/budget');
    expect(window.location.hash).toBe('#actual-insights');
    pushSpy.mockRestore();
  });
});

test('the native entry copies the selected look from the active item of the same level', async () => {
  document.body.innerHTML = NATIVE_SIDEBAR;
  unmount = mountSidebarEntry(document, window);
  await flush();
  const link = clickable(entries()[0]);
  // Unselected: the inactive top-level class, never the active one.
  expect(link.className).toBe('css-1trtw0g');

  window.history.pushState(null, '', '/budget#actual-insights');
  await flush();
  expect(link.className).toBe('css-7iovzr active');
  expect(document.querySelector('a[href="/budget"]').className).toBe('css-1trtw0g');
});

test('with both sidebars in the DOM (ABT hides Actual\'s), each gets one entry', async () => {
  document.body.innerHTML = NATIVE_SIDEBAR + ABT_SPLIT;
  unmount = mountSidebarEntry(document, window);
  await flush();
  expect(entries()).toHaveLength(2);
});

test('unmount removes the entries and restores any item it un-highlighted', async () => {
  document.body.innerHTML = ABT_SPLIT;
  window.history.replaceState(null, '', '/budget#actual-insights');
  unmount = mountSidebarEntry(document, window);
  await flush();
  const budget = document.querySelector('[aria-label="Budget"]');
  expect(budget.classList.contains('active')).toBe(false);

  unmount();
  unmount = null;
  expect(entries()).toHaveLength(0);
  expect(budget.classList.contains('active')).toBe(true);
});
