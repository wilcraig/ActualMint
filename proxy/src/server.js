const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const { injectTags } = require('./inject');

const ABT_ORIGIN = process.env.ABT_ORIGIN || 'http://abt:3005';
const ACTUALMINT_API_ORIGIN = process.env.ACTUALMINT_API_ORIGIN || 'http://actualmint-api:3011';
const PORT = Number(process.env.PORT || 3010);
const ACTUALMINT_BUNDLE_PATH = process.env.ACTUALMINT_BUNDLE_PATH || '/actualmint';
// Filesystem directory served under ACTUALMINT_BUNDLE_PATH. Volume-mounted at deploy time.
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || './static');
const API_PATH_PREFIX = '/api/';

const INJECTED_TAGS =
  `<script src="${ACTUALMINT_BUNDLE_PATH}/bundle.js"></script>` +
  `<link rel="stylesheet" href="${ACTUALMINT_BUNDLE_PATH}/bundle.css">`;

const DECODERS = {
  gzip: zlib.gunzip,
  deflate: zlib.inflate,
  br: zlib.brotliDecompress,
};

// RFC 7230 hop-by-hop headers: meaningful only for the immediate client/server
// connection, never for an intermediary to forward to a *new* connection.
// Forwarding these verbatim (especially `connection`) on a reused keep-alive
// socket corrupts response framing under concurrent load — intermittent
// 400s/ERR_ABORTED on otherwise-identical requests, worse the busier the page.
const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
];

function forwardableHeaders(reqHeaders, host) {
  const headers = { ...reqHeaders, host };
  for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
  return headers;
}

// Decodes a buffered upstream body so HTML can be rewritten. Identity bodies pass through.
function decodeBody(buffer, encoding, callback) {
  const decoder = encoding && DECODERS[encoding.trim().toLowerCase()];
  if (!encoding || encoding.trim().toLowerCase() === 'identity') return callback(null, buffer);
  if (!decoder) return callback(new Error(`unsupported content-encoding: ${encoding}`));
  decoder(buffer, callback);
}

// Proxies req to `origin`. When `rewriteHtml` is true, HTML responses get the bundle tags injected;
// otherwise every response streams through unmodified.
function proxyTo(origin, rewriteHtml, req, res) {
  const target = new URL(`${origin.replace(/\/$/, '')}${req.originalUrl}`);
  const transport = target.protocol === 'https:' ? https : http;

  // Host is replaced (the upstream expects its own); hop-by-hop headers are
  // stripped (see HOP_BY_HOP_HEADERS). accept-encoding is forwarded unchanged;
  // HTML bodies are decoded in decodeBody before rewriting.
  const headers = forwardableHeaders(req.headers, target.host);

  const upstreamReq = transport.request(target, { method: req.method, headers, agent: false }, (upstreamRes) => {
    const contentType = upstreamRes.headers['content-type'] || '';

    if (!rewriteHtml || !contentType.includes('text/html')) {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
    }

    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const raw = Buffer.concat(chunks);
      decodeBody(raw, upstreamRes.headers['content-encoding'], (decodeErr, decoded) => {
        if (decodeErr) {
          res.statusCode = 502;
          res.end(`actualmint-proxy: ${decodeErr.message}`);
          return;
        }
        const body = Buffer.from(injectTags(decoded.toString('utf8'), INJECTED_TAGS), 'utf8');
        const outHeaders = { ...upstreamRes.headers, 'content-length': body.length };
        delete outHeaders['content-encoding'];
        delete outHeaders['transfer-encoding'];
        res.writeHead(upstreamRes.statusCode, outHeaders);
        res.end(body);
      });
    });
    upstreamRes.on('error', () => res.destroy());
  });

  upstreamReq.on('error', (err) => {
    if (res.headersSent) return res.destroy();
    res.statusCode = 502;
    res.end(`actualmint-proxy: upstream ${origin} unreachable (${err.code || err.message})`);
  });

  req.pipe(upstreamReq);
}

function createApp({ abtOrigin = ABT_ORIGIN, apiOrigin = ACTUALMINT_API_ORIGIN } = {}) {
  const app = express();

  app.use(ACTUALMINT_BUNDLE_PATH, express.static(STATIC_DIR));
  // Anything under the bundle prefix that static did not serve is a 404, not a proxied abt request.
  app.use(ACTUALMINT_BUNDLE_PATH, (req, res) => res.status(404).end());
  // /api/* goes to actualmint-api as a plain passthrough (JSON, no HTML rewriting).
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith(API_PATH_PREFIX)) return proxyTo(apiOrigin, false, req, res);
    return next();
  });
  // Everything else is abt, with HTML responses rewritten to include the bundle.
  app.use((req, res) => proxyTo(abtOrigin, true, req, res));

  return app;
}

if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(
      `actualmint-proxy listening on :${PORT} -> abt ${ABT_ORIGIN}, api ${ACTUALMINT_API_ORIGIN} (/api/*), static ${STATIC_DIR} at ${ACTUALMINT_BUNDLE_PATH}`
    );
  });
}

module.exports = { createApp };
