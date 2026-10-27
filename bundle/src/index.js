import { mountWidget } from './mount';
import { maybeRedirectToReports } from './redirect';
import PacingBars from './widgets/PacingBars.svelte';
import MonthEndNet from './widgets/MonthEndNet.svelte';
import PaycheckAlertBanner from './widgets/PaycheckAlertBanner.svelte';
import BillsTimeline from './widgets/BillsTimeline.svelte';
import AccountBalancesChart from './widgets/AccountBalancesChart.svelte';
import { mountPanel } from './widget-builder/mount-panel';
import WidgetBuilderPanel from './widget-builder/WidgetBuilderPanel.svelte';

try {
  maybeRedirectToReports(window.location, window.sessionStorage);
} catch {
  // window.sessionStorage can throw a SecurityError when site storage is
  // blocked by the browser's privacy settings. That must never prevent the
  // pacing-bars widget below from mounting.
}

mountWidget('{{ACTUALMINT:pacing-bars:', (host, items) => {
  new PacingBars({ target: host, props: { items } });
});

// MonthEndNet takes no config (mount.js still requires the placeholder's body
// to parse as JSON, so an empty or missing body like `{{ACTUALMINT:month-end-net:}}`
// fails to parse and the widget never mounts). To add this widget, type the
// following literal text into an Actual Reports "Text widget":
//   {{ACTUALMINT:month-end-net:null}}
mountWidget('{{ACTUALMINT:month-end-net:', (host) => {
  new MonthEndNet({ target: host });
});

// PaycheckAlertBanner takes no config (mount.js still requires the
// placeholder's body to parse as JSON, so an empty or missing body like
// `{{ACTUALMINT:paycheck-alerts:}}` fails to parse and the widget never
// mounts). To add this widget, type the following literal text into an
// Actual Reports "Text widget":
//   {{ACTUALMINT:paycheck-alerts:null}}
mountWidget('{{ACTUALMINT:paycheck-alerts:', (host) => {
  new PaycheckAlertBanner({ target: host });
});

// BillsTimeline takes no config (mount.js still requires the placeholder's
// body to parse as JSON, so an empty or missing body like
// `{{ACTUALMINT:bills-timeline:}}` fails to parse and the widget never
// mounts). To add this widget, type the following literal text into an
// Actual Reports "Text widget":
//   {{ACTUALMINT:bills-timeline:null}}
mountWidget('{{ACTUALMINT:bills-timeline:', (host) => {
  new BillsTimeline({ target: host });
});

// AccountBalancesChart's config is an array of account ids to show (empty
// or omitted means every open account), the same convention as
// pacing-bars' categoryIds. To show every account, type the following
// literal text into an Actual Reports "Text widget":
//   {{ACTUALMINT:account-balances:[]}}
// or to show only specific accounts:
//   {{ACTUALMINT:account-balances:["accountId1","accountId2"]}}
mountWidget('{{ACTUALMINT:account-balances:', (host, accountIds) => {
  new AccountBalancesChart({ target: host, props: { accountIds } });
});

// Panel mounting has no dependency on sessionStorage, so it stays outside
// the try/catch above.
mountPanel(document, WidgetBuilderPanel);
