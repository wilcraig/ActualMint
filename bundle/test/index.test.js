// A thrown sessionStorage access (e.g. a SecurityError when site storage is
// blocked) must never prevent the pacing-bars widget from mounting - see
// index.js. mountWidget and maybeRedirectToReports are mocked so this test
// exercises only that ordering/guarding, not their own behavior (covered by
// mount.test.js and redirect.test.js).
import { vi, test, expect } from 'vitest';

vi.mock('../src/mount', () => ({ mountWidget: vi.fn() }));
vi.mock('../src/redirect', () => ({
  maybeRedirectToReports: vi.fn(() => {
    throw new DOMException('blocked', 'SecurityError');
  }),
}));
vi.mock('../src/widgets/PacingBars.svelte', () => ({ default: class {} }));
vi.mock('../src/widget-builder/mount-toolbar', () => ({ mountWidgetBuilderPanel: vi.fn() }));
vi.mock('../src/widget-builder/WidgetBuilderPanel.svelte', () => ({ default: class {} }));
vi.mock('../src/settings-panel/mount-settings', () => ({ mountSettingsSection: vi.fn() }));
vi.mock('../src/settings-panel/SettingsSection.svelte', () => ({ default: class {} }));

test('mountWidget still runs when accessing sessionStorage throws', async () => {
  const { mountWidget } = await import('../src/mount');

  await import('../src/index.js');

  expect(mountWidget).toHaveBeenCalled();
});

test('mountWidgetBuilderPanel is called to mount the widget-builder panel', async () => {
  // Without this, '../src/index.js' would resolve from the module cache
  // populated by the previous test's import, so this test's own import
  // wouldn't actually re-run index.js - the assertion would only pass
  // because the earlier test had already called mountWidgetBuilderPanel.
  vi.resetModules();

  const { mountWidgetBuilderPanel } = await import('../src/widget-builder/mount-toolbar');

  await import('../src/index.js');

  expect(mountWidgetBuilderPanel).toHaveBeenCalled();
});

test('mountSettingsSection is called to mount the settings-page section', async () => {
  vi.resetModules();

  const { mountSettingsSection } = await import('../src/settings-panel/mount-settings');

  await import('../src/index.js');

  expect(mountSettingsSection).toHaveBeenCalled();
});
