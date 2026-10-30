import GeneralTab from './GeneralTab.svelte';
import ChannelsTab from './ChannelsTab.svelte';
import PlaceholderTab from './PlaceholderTab.svelte';

// The Insights page's tabs, in tab-bar order. Ids match route.js's
// TAB_IDS (they name the tab in the URL hash). Summaries is a
// placeholder until its own plan swaps in the real component here.
export const TABS = [
  { id: 'general', label: 'General', component: GeneralTab },
  { id: 'summaries', label: 'Summaries', component: PlaceholderTab },
  { id: 'channels', label: 'Channels', component: ChannelsTab },
];
