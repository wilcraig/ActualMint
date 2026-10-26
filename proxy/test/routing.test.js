const http = require('http');
const { createApp } = require('../src/server');

// Starts a stub origin that records every request path it receives and answers with `label`.
function startStub(label) {
  const received = [];
  const server = http.createServer((req, res) => {
    received.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ origin: label }));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}` }))
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

    expect(res.body).toBe('{"origin":"api"}');
    expect(api.received).toEqual(['/api/budget-pacing?month=2026-10']);
    expect(abt.received).toEqual([]);
  });

  test('other paths are proxied to the abt origin', async () => {
    const res = await get(proxyPort, '/accounts/123');

    expect(res.body).toBe('{"origin":"abt"}');
    expect(abt.received).toEqual(['/accounts/123']);
    expect(api.received).toEqual([]);
  });

  test('a path that merely starts with the letters api is not treated as /api/', async () => {
    const res = await get(proxyPort, '/apiary/list');

    expect(res.body).toBe('{"origin":"abt"}');
    expect(abt.received).toEqual(['/apiary/list']);
    expect(api.received).toEqual([]);
  });

  test('unmatched bundle-prefix paths return 404 and reach neither origin', async () => {
    const res = await get(proxyPort, '/actualmint/missing.js');

    expect(res.status).toBe(404);
    expect(abt.received).toEqual([]);
    expect(api.received).toEqual([]);
  });
});
