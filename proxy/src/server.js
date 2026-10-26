const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const zlib = require('zlib');
const { injectTags } = require('./inject');

const ABT_ORIGIN = process.env.ABT_ORIGIN || 'http://abt:3005';
const PORT = Number(process.env.PORT || 3010);
const ACTUALMINT_BUNDLE_PATH = process.env.ACTUALMINT_BUNDLE_PATH || '/actualmint';
// Filesystem directory served under ACTUALMINT_BUNDLE_PATH. Volume-mounted at deploy time.
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || './static');

const INJECTED_TAGS =
  `<script src="${ACTUALMINT_BUNDLE_PATH}/bundle.js"></script>` +
  `<link rel="stylesheet" href="${ACTUALMINT_BUNDLE_PATH}/bundle.css">`;

const DECODERS = {
  gzip: zlib.gunzip,
  deflate: zlib.inflate,
  br: zlib.brotliDecompress,
};

// Decodes a buffered upstream body so HTML can be rewritten. Identity bodies pass through.
function decodeBody(buffer, encoding, callback) {
  const decoder = encoding && DECODERS[encoding.trim().toLowerCase()];
  if (!encoding || encoding.trim().toLowerCase() === 'identity') return callback(null, buffer);
  if (!decoder) return callback(new Error(`unsupported content-encoding: ${encoding}`));
  decoder(buffer, callback);
}

function proxyToAbt(req, res) {
  const target = new URL(`${ABT_ORIGIN.replace(/\/$/, '')}${req.originalUrl}`);
  const transport = target.protocol === 'https:' ? https : http;

  // Drop hop-specific and host headers; the upstream sets its own Host.
  const headers = { ...req.headers, host: target.host };
  // Ask upstream for an identity body so HTML can be rewritten without decoding.
  delete headers['accept-encoding'];

  const upstreamReq = transport.request(target, { method: req.method, headers }, (upstreamRes) => {
    const contentType = upstreamRes.headers['content-type'] || '';

    if (!contentType.includes('text/html')) {
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
    res.end(`actualmint-proxy: upstream ${ABT_ORIGIN} unreachable (${err.code || err.message})`);
  });

  req.pipe(upstreamReq);
}

function createApp() {
  const app = express();

  app.use(ACTUALMINT_BUNDLE_PATH, express.static(STATIC_DIR));
  // Anything under the bundle prefix that static did not serve is a 404, not a proxied abt request.
  app.use(ACTUALMINT_BUNDLE_PATH, (req, res) => res.status(404).end());
  app.use((req, res) => proxyToAbt(req, res));

  return app;
}

if (require.main === module) {
  createApp().listen(PORT, () => {
    console.log(`actualmint-proxy listening on :${PORT} -> ${ABT_ORIGIN}, static ${STATIC_DIR} at ${ACTUALMINT_BUNDLE_PATH}`);
  });
}

module.exports = { createApp };
