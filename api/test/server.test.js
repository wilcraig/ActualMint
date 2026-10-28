jest.mock('@actual-app/api', () => ({
  init: jest.fn().mockResolvedValue(),
  downloadBudget: jest.fn().mockResolvedValue(),
  shutdown: jest.fn().mockResolvedValue(),
}));

async function withServer(fn) {
  const app = require('../src/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('malformed JSON body with no token returns 401, not a 400 JSON-parse error', async () => {
  // express.json() is registered after requireAuth specifically so an
  // unauthenticated caller never reaches body parsing at all -- confirms
  // the ordering in server.js rather than just reading it.
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/goals/g1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.status).toBe(401);
  });
});

test('/health is 503 until the Actual client has connected once', async () => {
  const { getActualClient } = require('../src/actual-client');

  await withServer(async (base) => {
    const before = await fetch(`${base}/health`);
    expect(before.status).toBe(503);
    expect(await before.json()).toEqual({ ok: false });

    await getActualClient();

    const after = await fetch(`${base}/health`);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ ok: true });
  });
});
