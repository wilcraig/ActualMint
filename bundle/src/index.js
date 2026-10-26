import { mountWidget } from './mount';
import { maybeRedirectToReports } from './redirect';
import PacingBars from './widgets/PacingBars.svelte';
import { mountPanel } from './widget-builder/mount-panel';
import WidgetBuilderPanel from './widget-builder/WidgetBuilderPanel.svelte';

try {
  maybeRedirectToReports(window.location, window.sessionStorage);
} catch {
  // window.sessionStorage can throw a SecurityError when site storage is
  // blocked by the browser's privacy settings. That must never prevent the
  // pacing-bars widget below from mounting.
}

mountWidget('{{ACTUALMINT:pacing-bars:', (host, categoryIds) => {
  new PacingBars({ target: host, props: { categoryIds } });
});

// Panel mounting has no dependency on sessionStorage, so it stays outside
// the try/catch above.
mountPanel(document, WidgetBuilderPanel);
