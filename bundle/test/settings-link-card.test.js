import SettingsLinkCard from '../src/settings-panel/SettingsLinkCard.svelte';

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  window.history.replaceState(null, '', '/settings');
});

test('renders the Actual Insights card with a pointer to the Insights page', () => {
  new SettingsLinkCard({ target: document.getElementById('host') });

  const host = document.getElementById('host');
  expect(host.querySelector('.section-title').textContent).toBe('Actual Insights');
  expect(host.textContent).toContain(
    'Settings, savings goals, summaries and notification channels now live on the Insights page.',
  );
  const button = host.querySelector('button');
  expect(button.textContent.trim()).toBe('Open Insights');
});

test('"Open Insights" opens the Insights page in place', () => {
  new SettingsLinkCard({ target: document.getElementById('host') });
  const pushSpy = vi.spyOn(window.history, 'pushState');

  document.querySelector('#host button').click();

  expect(pushSpy).toHaveBeenCalled();
  expect(window.location.pathname).toBe('/settings');
  expect(window.location.hash).toBe('#actual-insights');
  pushSpy.mockRestore();
});
