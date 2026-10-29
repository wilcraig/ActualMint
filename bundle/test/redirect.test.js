import { maybeRedirectToReports } from '../src/redirect';

// Confirmed against the actual, open-source `actualbudget/actual` repo at
// tag `v26.10.0` (the exact version pinned in the deployed
// `ghcr.io/actualbudget/actual:26.10.0` image) -
// `packages/desktop-client/src/components/FinancesApp.tsx`: plain
// path-based react-router routes, no hashes - `/` (redirects to
// `/budget`), `/budget` (Budget view), and `/reports/*` (Reports view,
// which also matches `/reports` itself).
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
  };
}

test('redirects from root once, sets the flag', () => {
  const location = { pathname: '/', href: '' };
  const storage = fakeStorage();

  maybeRedirectToReports(location, storage);

  expect(location.href).toBe('/reports');
  expect(storage.getItem('insights:redirected')).toBeTruthy();
});

test('redirects from the Budget page too', () => {
  const location = { pathname: '/budget', href: '' };
  const storage = fakeStorage();

  maybeRedirectToReports(location, storage);

  expect(location.href).toBe('/reports');
  expect(storage.getItem('insights:redirected')).toBeTruthy();
});

test('does not redirect a second time in the same tab', () => {
  const location = { pathname: '/', href: '' };
  const storage = fakeStorage();
  storage.setItem('insights:redirected', '1');

  maybeRedirectToReports(location, storage);

  expect(location.href).toBe('');
});

test('does not redirect when already on a non-Budget route', () => {
  const location = { pathname: '/reports', href: '' };
  const storage = fakeStorage();

  maybeRedirectToReports(location, storage);

  expect(location.href).toBe('');
});
