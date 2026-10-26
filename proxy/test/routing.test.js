const http = require('http');
const { createApp } = require('../src/server');

// Starts a stub origin that records every request path AND headers it
// receives, and answers with `label` after a small delay (so concurrent
// requests actually overlap in flight, the condition that reproduces
// header/connection-reuse bugs — a stub that answers instantly never does).
function startStub(label, { delayMs = 0 } = {}) {
  const received = [];
  const receivedHeaders = [];
  const server = http.createServer((req, res) => {
    received.push(req.url);
    receivedHeaders.push(req.headers);
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ origin: label, url: req.url }));
    }, delayMs);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, received, receivedHeaders, url: `http://127.0.0.1:${server.address().port}` })
    )
  );
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

describe('request routing', () => {
  let abt;
  let api;
  let proxy;
  let proxyPort;

  beforeAll(async () => {
    abt = await startStub('abt');
    api = await startStub('api');
    const app = createApp({ abtOrigin: abt.url, apiOrigin: api.url });
    proxy = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => proxy.once('listening', resolve));
    proxyPort = proxy.address().port;
  });

  afterAll(() => {
    proxy.close();
    abt.server.close();
    api.server.close();
  });

  beforeEach(() => {
    abt.received.length = 0;
    api.received.length = 0;
  });

  test('/api/* is proxied to the actualmint-api origin with the path preserved', async () => {
    const res = await get(proxyPort, '/api/budget-pacing?month=2026-10');

    expect(JSON.parse(res.body)).toEqual({ origin: 'api', url: '/api/budget-pacing?month=2026-10' });
    expect(api.received).toEqual(['/api/budget-pacing?month=2026-10']);
    expect(abt.received).toEqual([]);
  });

  test('other paths are proxied to the abt origin', async () => {
    const res = await get(proxyPort, '/accounts/123');

    expect(JSON.parse(res.body)).toEqual({ origin: 'abt', url: '/accounts/123' });
    expect(abt.received).toEqual(['/accounts/123']);
    expect(api.received).toEqual([]);
  });

  test('a path that merely starts with the letters api is not treated as /api/', async () => {
    const res = await get(proxyPort, '/apiary/list');

    expect(JSON.parse(res.body)).toEqual({ origin: 'abt', url: '/apiary/list' });
    expect(abt.received).toEqual(['/apiary/list']);
    expect(api.received).toEqual([]);
  });

  test('unmatched bundle-prefix paths return 404 and reach neither origin', async () => {
    const res = await get(proxyPort, '/actualmint/missing.js');

    expect(res.status).toBe(404);
    expect(abt.received).toEqual([]);
    expect(api.received).toEqual([]);
  });

  test('hop-by-hop headers are not forwarded upstream', async () => {
    await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: proxyPort, path: '/accounts/123', headers: { connection: 'keep-alive' } },
        (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
      req.end();
    });

    // Node sets its own `connection` header once (`close`, from `agent: false`)
    // — the assertion is that the *client's* value ("keep-alive") never
    // reaches upstream verbatim, not that the header is absent entirely.
    expect(abt.receivedHeaders[0].connection).not.toBe('keep-alive');
  });

  test('many concurrent requests to the same origin each get their own matching response, not a mismatched one', async () => {
    // Reproduces the real bug: forwarding hop-by-hop headers (or reusing a
    // single keep-alive socket incorrectly) under concurrent load corrupts
    // response framing, so a request for path N can come back with path M's
    // body. A fast, non-delayed stub never overlaps requests in flight, so
    // this needs the delayed stub set up below instead of the shared one.
    const delayedAbt = await startStub('abt-delayed', { delayMs: 20 });
    const app = createApp({ abtOrigin: delayedAbt.url, apiOrigin: api.url });
    const concurrentProxy = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => concurrentProxy.once('listening', resolve));
    const port = concurrentProxy.address().port;

    try {
      const paths = Array.from({ length: 20 }, (_, i) => `/item/${i}`);
      const results = await Promise.all(paths.map((p) => get(port, p)));
      results.forEach((res, i) => {
        expect(JSON.parse(res.body)).toEqual({ origin: 'abt-delayed', url: paths[i] });
      });
    } finally {
      concurrentProxy.close();
      delayedAbt.server.close();
    }
  });
});
