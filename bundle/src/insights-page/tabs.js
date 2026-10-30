import GeneralTab from './GeneralTab.svelte';
import PlaceholderTab from './PlaceholderTab.svelte';

// The Insights page's tabs, in tab-bar order. Ids match route.js's
// TAB_IDS (they name the tab in the URL hash). Summaries and Channels are
// placeholders until their own plans swap in the real components here.
export const TABS = [
  { id: 'general', label: 'General', component: GeneralTab },
  { id: 'summaries', label: 'Summaries', component: PlaceholderTab },
  { id: 'channels', label: 'Channels', component: PlaceholderTab },
];
