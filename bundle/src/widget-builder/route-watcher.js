// Watches Actual's client-side route (plain path-based react-router, see
// ../redirect.js) so the widget-builder panel can react to in-app
// navigation, which fires no page load.

/**
 * True for `/reports` and any `/reports/*` path (matching the Reports view
 * routes confirmed in redirect.js).
 * @param {string} pathname
 */
export function isReportsPath(pathname) {
  return pathname === '/reports' || pathname.startsWith('/reports/');
}

/**
 * Calls `onChange` with the current pathname immediately, then again on every
 * `history.pushState`, `history.replaceState`, or `popstate`.
 * @param {Window} win
 * @param {(pathname: string) => void} onChange
 * @returns {() => void} unwatch - removes listeners and restores history methods
 */
export function watchRoute(win, onChange) {
  const { history } = win;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const notify = () => onChange(win.location.pathname);

  history.pushState = function (...args) {
    const result = originalPushState.apply(history, args);
    notify();
    return result;
  };
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(history, args);
    notify();
    return result;
  };
  win.addEventListener('popstate', notify);

  notify();

  return function unwatch() {
    win.removeEventListener('popstate', notify);
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  };
}
