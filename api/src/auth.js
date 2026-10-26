// Validates a session token against Actual's own account server, the same
// way Actual's web client does (see @actual-app/core, the bundled source
// matching the deployed server version):
//   - header:   api/node_modules/@actual-app/core/src/server/auth/app.ts
//               getUser() sends `X-ACTUAL-TOKEN: <token>`
//   - endpoint: api/node_modules/@actual-app/core/src/server/server-config.ts
//               SIGNUP_SERVER is `<ACTUAL_SERVER_URL>/account`, so validation
//               is a GET to `<ACTUAL_SERVER_URL>/account/validate`
//   - response: api/node_modules/@actual-app/core/src/server/post.ts `get()`
//               never throws on a non-200 status; the body is always JSON
//               shaped `{ status: 'ok' | 'error', reason?, data? }`
// Anything other than `status === 'ok'` — including a network failure or a
// non-JSON body — is treated as invalid. This check never writes to Actual.

const CACHE_TTL_MS = 60 * 1000;

// token -> { valid, expiresAt }
const cache = new Map();

async function checkWithActual(token) {
  const serverUrl = process.env.ACTUAL_SERVER_URL;
  try {
    const res = await fetch(`${serverUrl}/account/validate`, {
      headers: { 'X-ACTUAL-TOKEN': token },
    });
    const text = await res.text();
    const { status } = JSON.parse(text);
    return status === 'ok';
  } catch {
    return false;
  }
}

async function validateToken(token) {
  if (!token) {
    return false;
  }

  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.valid;
  }

  const valid = await checkWithActual(token);
  cache.set(token, { valid, expiresAt: Date.now() + CACHE_TTL_MS });
  return valid;
}

module.exports = { validateToken };
