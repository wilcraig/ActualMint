import { fetchApi } from '../src/api-client';

// jsdom does not implement IndexedDB at all (`globalThis.indexedDB` is
// `undefined` in this test environment), so these tests stub it directly
// with a minimal fake that mimics the shape `api-client.js` depends on:
// `indexedDB.open(name)` returning an `IDBOpenDBRequest`-like object whose
// `onsuccess` fires with a fake `IDBDatabase` (`objectStoreNames.contains`,
// `transaction().objectStore().get()`). This matches the real shape
// confirmed in `@actual-app/core`'s `platform/server/indexeddb` and
// `asyncStorage` modules (database `actual`, object store `asyncStorage`,
// key `'user-token'`).
function stubIndexedDb({ hasStore, token } = {}) {
  const fakeStore = {
    get(key) {
      const req = { result: undefined, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        req.result = key === 'user-token' ? token : undefined;
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };

  const fakeDb = {
    objectStoreNames: {
      contains: (name) => (hasStore ? name === 'asyncStorage' : false),
    },
    transaction: () => ({
      objectStore: () => fakeStore,
    }),
    close: () => {},
  };

  const fakeIndexedDb = {
    open() {
      const req = { result: fakeDb, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };

  vi.stubGlobal('indexedDB', fakeIndexedDb);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('attaches the session token to the request', async () => {
  stubIndexedDb({ hasStore: true, token: 'secret-token-123' });
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await fetchApi('/api/budget-pacing?month=2026-10');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [calledPath, calledOptions] = fetchMock.mock.calls[0];
  expect(calledPath).toBe('/api/budget-pacing?month=2026-10');
  const headers = new Headers(calledOptions.headers);
  expect(headers.get('X-ACTUAL-TOKEN')).toBe('secret-token-123');
});

test('does not attach a header/token when none is present', async () => {
  stubIndexedDb({ hasStore: true, token: undefined });
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await fetchApi('/api/budget-pacing?month=2026-10');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, calledOptions] = fetchMock.mock.calls[0];
  const headers = new Headers(calledOptions?.headers);
  expect(headers.get('X-ACTUAL-TOKEN')).toBeNull();
});

test('proceeds without a token when the asyncStorage object store does not exist', async () => {
  stubIndexedDb({ hasStore: false });
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await fetchApi('/api/budget-pacing?month=2026-10');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, calledOptions] = fetchMock.mock.calls[0];
  const headers = new Headers(calledOptions?.headers);
  expect(headers.get('X-ACTUAL-TOKEN')).toBeNull();
});

test('proceeds without a token when indexedDB is unavailable entirely', async () => {
  // No stub at all: globalThis.indexedDB stays undefined, as it genuinely
  // is in this jsdom environment.
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await fetchApi('/api/budget-pacing?month=2026-10');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, calledOptions] = fetchMock.mock.calls[0];
  const headers = new Headers(calledOptions?.headers);
  expect(headers.get('X-ACTUAL-TOKEN')).toBeNull();
});

test('proceeds without a token when opening the database fails', async () => {
  vi.stubGlobal('indexedDB', {
    open() {
      const req = { onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (req.onerror) req.onerror(new Error('boom'));
      });
      return req;
    },
  });
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  await fetchApi('/api/budget-pacing?month=2026-10');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, calledOptions] = fetchMock.mock.calls[0];
  const headers = new Headers(calledOptions?.headers);
  expect(headers.get('X-ACTUAL-TOKEN')).toBeNull();
});
