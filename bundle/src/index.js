import { mountWidget } from './mount';
import PacingBars from './widgets/PacingBars.svelte';

mountWidget('{{ACTUALMINT:pacing-bars:', (host, categoryIds) => {
  new PacingBars({ target: host, props: { categoryIds } });
});
