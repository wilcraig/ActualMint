vi.mock('../src/api-client', () => ({
  fetchApi: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
}));

import { mountInsightsPage, findContentRegion } from '../src/insights-page/mount-page';
import { TABS } from '../src/insights-page/tabs';
import GeneralTab from '../src/insights-page/GeneralTab.svelte';
import PlaceholderTab from '../src/insights-page/PlaceholderTab.svelte';

// A cut-down copy of Actual's main column (docs/insights-page-hosting-notes.md):
// a title bar holding the help button, then the page content. jsdom has no
// layout, so the heights findContentRegion measures are stubbed.
const APP_HTML = `
  <div id="sidebar">sidebar</div>
  <div id="main-column">
    <div id="titlebar"><div><button data-testid="help-menu-button">Help</button></div></div>
    <div id="notifications"></div>
    <div id="content">Budget table</div>
  </div>
`;

function stubHeight(el, height) {
  el.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 300, right: 1300, bottom: height, width: 1000, height });
}

function stubLayout() {
  stubHeight(document.getElementById('main-column'), 900);
  stubHeight(document.getElementById('titlebar'), 48);
  stubHeight(document.querySelector('#titlebar > div'), 28);
  stubHeight(document.getElementById('notifications'), 0);
  stubHeight(document.getElementById('content'), 852);
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let unwatch = null;

beforeEach(() => {
  document.body.innerHTML = APP_HTML;
  stubLayout();
  window.history.replaceState(null, '', '/budget');
});

afterEach(() => {
  unwatch?.();
  unwatch = null;
  document.querySelectorAll('[data-insights-page]').forEach((el) => el.remove());
});

function pageContainer() {
  return document.querySelector('[data-insights-page]');
}

function isShown(el) {
  return el.style.display !== 'none';
}

test('TABS lists General, Summaries, Channels with General as the real tab', () => {
  expect(TABS.map((t) => t.id)).toEqual(['general', 'summaries', 'channels']);
  expect(TABS.map((t) => t.label)).toEqual(['General', 'Summaries', 'Channels']);
  expect(TABS[0].component).toBe(GeneralTab);
  expect(TABS[1].component).toBe(PlaceholderTab);
  expect(TABS[2].component).toBe(PlaceholderTab);
});

test('findContentRegion finds the tallest sibling after the title bar', () => {
  expect(findContentRegion(document)).toBe(document.getElementById('content'));
});

test('findContentRegion returns null before Actual has rendered its title bar', () => {
  document.body.innerHTML = '<div id="root"></div>';
  expect(findContentRegion(document)).toBeNull();
});

test('the page is hidden at /budget and shown at /budget#actual-insights', async () => {
  unwatch = mountInsightsPage(document, window);
  const container = pageContainer();
  expect(container).not.toBeNull();
  expect(isShown(container)).toBe(false);
  expect(document.getElementById('content').style.visibility).toBe('');

  window.history.pushState(null, '', '/budget#actual-insights');
  await flush();

  expect(isShown(container)).toBe(true);
  expect(container.textContent).toContain('Actual Insights');
  // Actual's own content is hidden underneath, the title bar is not.
  expect(document.getElementById('content').style.visibility).toBe('hidden');
  expect(document.getElementById('titlebar').style.visibility).toBe('');
});

test('a direct load with the hash already set shows the page', async () => {
  window.history.replaceState(null, '', '/budget#actual-insights/channels');
  unwatch = mountInsightsPage(document, window);
  await flush();

  expect(isShown(pageContainer())).toBe(true);
  expect(pageContainer().querySelector('[role="tab"][aria-selected="true"]').textContent.trim()).toBe('Channels');
});

test('#actual-insights/summaries selects the Summaries tab and renders the placeholder', async () => {
  unwatch = mountInsightsPage(document, window);
  window.history.pushState(null, '', '/budget#actual-insights/summaries');
  await flush();

  const container = pageContainer();
  const selected = container.querySelector('[role="tab"][aria-selected="true"]');
  expect(selected.textContent.trim()).toBe('Summaries');
  expect(container.querySelector('.actualmint-placeholder-tab')).not.toBeNull();
  expect(container.querySelector('.actualmint-general-tab')).toBeNull();
});

test('clicking the Channels tab updates location.hash and shows that tab', async () => {
  unwatch = mountInsightsPage(document, window);
  window.history.pushState(null, '', '/budget#actual-insights');
  await flush();

  const container = pageContainer();
  expect(container.querySelector('.actualmint-general-tab')).not.toBeNull();

  const channels = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (b) => b.textContent.trim() === 'Channels',
  );
  channels.click();
  await flush();

  expect(window.location.pathname).toBe('/budget');
  expect(window.location.hash).toBe('#actual-insights/channels');
  expect(channels.getAttribute('aria-selected')).toBe('true');
  expect(container.querySelector('.actualmint-general-tab')).toBeNull();
});

test('a hashchange (typed URL, back button) is picked up too', async () => {
  unwatch = mountInsightsPage(document, window);
  window.location.hash = '#actual-insights/summaries';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await flush();

  expect(isShown(pageContainer())).toBe(true);
  expect(pageContainer().querySelector('[role="tab"][aria-selected="true"]').textContent.trim()).toBe('Summaries');
});

test('navigating away hides the page and restores Actual content; coming back reuses the same container', async () => {
  unwatch = mountInsightsPage(document, window);
  window.history.pushState(null, '', '/budget#actual-insights/summaries');
  await flush();
  const container = pageContainer();
  const tabBar = container.querySelector('[role="tablist"]');

  window.history.pushState(null, '', '/reports');
  await flush();
  expect(isShown(container)).toBe(false);
  expect(document.getElementById('content').style.visibility).toBe('');

  window.history.pushState(null, '', '/reports#actual-insights/summaries');
  await flush();
  expect(pageContainer()).toBe(container);
  expect(container.querySelector('[role="tablist"]')).toBe(tabBar);
  expect(document.querySelectorAll('[data-insights-page]')).toHaveLength(1);
  expect(isShown(container)).toBe(true);
});

test('dispatches insights:page-shown each time the page opens (so the goals list refetches)', async () => {
  const listener = vi.fn();
  document.addEventListener('insights:page-shown', listener);
  unwatch = mountInsightsPage(document, window);

  window.history.pushState(null, '', '/budget#actual-insights');
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);

  // Switching tabs isn't re-opening.
  window.history.pushState(null, '', '/budget#actual-insights/channels');
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);

  window.history.pushState(null, '', '/budget');
  window.history.pushState(null, '', '/budget#actual-insights');
  await flush();
  expect(listener).toHaveBeenCalledTimes(2);
  document.removeEventListener('insights:page-shown', listener);
});

test('waits for Actual to render its content region before showing', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', '/budget#actual-insights');
  unwatch = mountInsightsPage(document, window);
  await flush();
  expect(isShown(pageContainer())).toBe(false);

  document.getElementById('root').innerHTML = APP_HTML;
  stubLayout();
  await flush();

  expect(isShown(pageContainer())).toBe(true);
  expect(document.getElementById('content').style.visibility).toBe('hidden');
});
