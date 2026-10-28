import { mountWidget } from './mount';
import { maybeRedirectToReports } from './redirect';
import PacingBars from './widgets/PacingBars.svelte';
import MonthEndNet from './widgets/MonthEndNet.svelte';
import PaycheckAlertBanner from './widgets/PaycheckAlertBanner.svelte';
import BillsTimeline from './widgets/BillsTimeline.svelte';
import AccountBalancesChart from './widgets/AccountBalancesChart.svelte';
import UnlinkedTransfers from './widgets/UnlinkedTransfers.svelte';
import SpendingBreakdownDonut from './widgets/SpendingBreakdownDonut.svelte';
import SavingsGoalsThermometers from './widgets/SavingsGoalsThermometers.svelte';
import BurnRateChart from './widgets/BurnRateChart.svelte';
import SpendingHeatmap from './widgets/SpendingHeatmap.svelte';
import { mountWidgetBuilderPanel } from './widget-builder/mount-toolbar';
import WidgetBuilderPanel from './widget-builder/WidgetBuilderPanel.svelte';
import { mountSettingsSection } from './settings-panel/mount-settings';
import SettingsSection from './settings-panel/SettingsSection.svelte';
import { PRESETS, loadSavedScale, applyScale } from './text-scale';
import { loadSavedMintThemeEnabled, applyMintTheme } from './mint-theme';
import { fixBudgetIconCrop } from './budget-icon-fix';

// Pure CSS, no DOM dependency beyond `document.head` -- safe to run
// unconditionally on every page load, independent of sessionStorage.
fixBudgetIconCrop(document);

// Applies the saved text size and Mint-style theme on every page load
// (Budget and Schedules pages included, not just /reports*) -- both are
// controlled from a settings card on Actual's own Settings page (see
// settings-panel/), not a floating button, but still need to take effect
// everywhere, not just while that page is open. Referencing
// `window.localStorage` can itself throw (not just its methods) under
// strict privacy settings, so each is guarded independently.
try {
  applyScale(document, loadSavedScale(window.localStorage));
} catch {
  applyScale(document, PRESETS[0].px);
}
try {
  applyMintTheme(document, loadSavedMintThemeEnabled(window.localStorage));
} catch {
  applyMintTheme(document, false);
}

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

// AccountBalancesChart's config is EITHER a bare array of account ids
// (empty or omitted means every open account, the original convention,
// same as pacing-bars' categoryIds -- kept working for every dashboard
// that already carries this older, bare-array form) OR an object with an
// `accountIds` array and a `labelContent` ('both' | 'amount' | 'name',
// defaulting to 'both') controlling what the combined view's in-band
// label shows. To show every account with the default label, type the
// following literal text into an Actual Reports "Text widget":
//   {{ACTUALMINT:account-balances:[]}}
// or to show only specific accounts:
//   {{ACTUALMINT:account-balances:["accountId1","accountId2"]}}
// or, to also set labelContent:
//   {{ACTUALMINT:account-balances:{"accountIds":[],"labelContent":"amount"}}}
mountWidget('{{ACTUALMINT:account-balances:', (host, config) => {
  const accountIds = Array.isArray(config) ? config : (config?.accountIds ?? []);
  const labelContent = Array.isArray(config) ? 'both' : (config?.labelContent ?? 'both');
  new AccountBalancesChart({ target: host, props: { accountIds, labelContent } });
});

// UnlinkedTransfers takes no config, same convention as month-end-net and
// paycheck-alerts above. To add this widget, type the following literal
// text into an Actual Reports "Text widget":
//   {{ACTUALMINT:unlinked-transfers:null}}
mountWidget('{{ACTUALMINT:unlinked-transfers:', (host) => {
  new UnlinkedTransfers({ target: host });
});

// SpendingBreakdownDonut's config is an array of category-group ids to show
// (empty or omitted means every expense group), the same convention as
// account-balances' accountIds. To show every group, type the following
// literal text into an Actual Reports "Text widget":
//   {{ACTUALMINT:spending-breakdown-donut:[]}}
// or to show only specific groups:
//   {{ACTUALMINT:spending-breakdown-donut:["groupId1","groupId2"]}}
mountWidget('{{ACTUALMINT:spending-breakdown-donut:', (host, groupIds) => {
  new SpendingBreakdownDonut({ target: host, props: { groupIds } });
});

// SavingsGoalsThermometers' config is a bare array of category ids to show
// (empty or omitted means every goal-tracked category), same convention as
// pacing-bars' categoryIds. To show every goal-tracked category, type the
// following literal text into an Actual Reports "Text widget":
//   {{ACTUALMINT:savings-goals-thermometers:[]}}
// or to show only specific categories:
//   {{ACTUALMINT:savings-goals-thermometers:["categoryId1","categoryId2"]}}
mountWidget('{{ACTUALMINT:savings-goals-thermometers:', (host, categoryIds) => {
  new SavingsGoalsThermometers({ target: host, props: { categoryIds } });
});

// BurnRateChart takes no config (mount.js still requires the placeholder's
// body to parse as JSON, so an empty or missing body like
// `{{ACTUALMINT:burn-rate:}}` fails to parse and the widget never mounts).
// Zero-config, current-month only (no month picker in v1), same posture as
// month-end-net. To add this widget, type the following literal text into
// an Actual Reports "Text widget":
//   {{ACTUALMINT:burn-rate:null}}
mountWidget('{{ACTUALMINT:burn-rate:', (host) => {
  new BurnRateChart({ target: host });
});

// SpendingHeatmap's config is an object with a `range` of 'month' (the
// default, last 30 days) or 'year' (last 12 months) -- same `select`-field
// convention as account-balances' labelContent. To show the default
// 30-day view, type the following literal text into an Actual Reports
// "Text widget":
//   {{ACTUALMINT:spending-heatmap:{}}}
// or to show the last 12 months:
//   {{ACTUALMINT:spending-heatmap:{"range":"year"}}}
mountWidget('{{ACTUALMINT:spending-heatmap:', (host, config) => {
  const range = config?.range ?? 'month';
  new SpendingHeatmap({ target: host, props: { range } });
});

// Panel mounting has no dependency on sessionStorage, so it stays outside
// the try/catch above.
mountWidgetBuilderPanel(document, window, WidgetBuilderPanel);

// Text size and Mint-style theme are controlled from a settings card
// injected next to Actual's own "Themes" card on /settings, not a floating
// button -- see settings-panel/mount-settings.js.
mountSettingsSection(document, window, SettingsSection);
