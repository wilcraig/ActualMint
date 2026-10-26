import { mountWidget } from './mount';
import { maybeRedirectToReports } from './redirect';
import PacingBars from './widgets/PacingBars.svelte';

maybeRedirectToReports(window.location, window.sessionStorage);

mountWidget('{{ACTUALMINT:pacing-bars:', (host, categoryIds) => {
  new PacingBars({ target: host, props: { categoryIds } });
});
