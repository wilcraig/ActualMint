# ActualMint

ActualMint is a set of packages layered on top of Actual Budget (`abt`).

## Packages

- `proxy/` — `actualmint-proxy`: reverse proxy in front of `abt`. Passes requests through unchanged, injects the ActualMint bundle `<script>`/`<link>` tags into HTML responses, and serves the bundle's static files under `ACTUALMINT_BUNDLE_PATH`.

## actualmint-proxy configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `ABT_ORIGIN` | `http://abt:3005` | Upstream `abt` origin to proxy to |
| `PORT` | `3010` | Port the proxy listens on |
| `ACTUALMINT_BUNDLE_PATH` | `/actualmint` | URL path prefix the bundle is served under |
| `STATIC_DIR` | `./static` | Filesystem directory served under `ACTUALMINT_BUNDLE_PATH` |

## Development

```sh
cd proxy
npm install
npm test
npm start
```
