// Sends a tab that lands on Actual's root or Budget page to the Reports
// page instead, where Actual Insights' widgets live - once per tab, so it
// never fights deliberate navigation back to Budget later.
//
// Route paths confirmed against the actual, open-source
// `actualbudget/actual` repo at tag `v26.10.0` (the exact version pinned
// in the deployed `ghcr.io/actualbudget/actual:26.10.0` image) -
// `packages/desktop-client/src/components/FinancesApp.tsx`: plain
// path-based react-router routing, no hashes. `/` redirects to `/budget`,
// `/budget` renders the Budget view, and `/reports/*` renders Reports
// (which also matches `/reports` itself).

import { isInsightsPageHash } from './insights-page/route';

const REDIRECTED_KEY ='insights:redirected';
const REPORTS_PATH = '/reports';
const REDIRECT_FROM_PATHS = new Set(['/', '/budget']);

/**
 * @param {Location} location
 * @param {Storage} sessionStorage
 */
export function maybeRedirectToReports(location, sessionStorage) {
  // A bookmarked or refreshed `/budget#actual-insights` is a deliberate
  // trip to the Insights page; `location.href` would drop its hash.
  if (isInsightsPageHash(location.hash)) return;
  if (sessionStorage.getItem(REDIRECTED_KEY)) return;
  if (!REDIRECT_FROM_PATHS.has(location.pathname)) return;

  sessionStorage.setItem(REDIRECTED_KEY, '1');
  location.href = REPORTS_PATH;
}
