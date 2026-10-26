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
vi.mock('../src/widget-builder/mount-panel', () => ({ mountPanel: vi.fn() }));
vi.mock('../src/widget-builder/WidgetBuilderPanel.svelte', () => ({ default: class {} }));

test('mountWidget still runs when accessing sessionStorage throws', async () => {
  const { mountWidget } = await import('../src/mount');

  await import('../src/index.js');

  expect(mountWidget).toHaveBeenCalled();
});

test('mountPanel is called to mount the widget-builder panel', async () => {
  const { mountPanel } = await import('../src/widget-builder/mount-panel');

  await import('../src/index.js');

  expect(mountPanel).toHaveBeenCalled();
});
