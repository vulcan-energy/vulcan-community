# Self-hosting Vulcan Community

Vulcan Community is a static browser application. Build it, serve the contents
of `apps/geometry-editor/dist/` at the origin root over HTTPS, and configure the
response headers below on every path. The File System Access API requires a
secure context and a Chromium-based browser.

Use Node.js 22 and clone with `--recurse-submodules`, or initialize the pinned
HEM and FHS sources before building. The model-WASM build script also checks for
its required nightly Rust toolchain, `rust-src`, WASM target, and `wasm-pack`.
From a standalone Vulcan Community checkout:

```bash
git submodule update --init --recursive
npm ci
./scripts/build-model-wasm.sh
npm run build --workspace @vulcan-community/geometry-editor-app
```

IFC import is optional. To include it in a deployment, fetch the pinned
third-party wheel before building:

```bash
./scripts/fetch-ifc-wheel.sh
```

The README's IFC section covers the wheel's size, licence and provenance.
Without the wheel the site builds and serves normally, and IFC import fails
when invoked.

The final command writes the deployable site to
`apps/geometry-editor/dist/`. Configure a single-page application fallback so
unknown application paths serve `index.html` rather than a host-branded 404.

## Required response headers

FHS preprocessing uses Rayon through `wasm-bindgen-rayon`. Browser Rayon workers
require `SharedArrayBuffer`, and browsers expose `SharedArrayBuffer` only when
the document is cross-origin isolated. The deployed site must return these
headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:
```

Without the COOP and COEP headers, the editor still loads and Core editing still
works, but FHS preflight does not work. The editor reports this as a deployment
configuration error when an FHS model is saved.

The production Content Security Policy intentionally does not permit `ws:`.
The Vite development server adds that source only for its hot-module reload
socket.

IFC import has one additional network requirement. At the moment IFC import is
invoked, its browser worker fetches the pinned Pyodide runtime from
`https://cdn.jsdelivr.net`. If a deployment replaces or extends the policy
above, both `script-src` and `connect-src` must continue to permit that host for
IFC import to work. Ordinary editing does not fetch Pyodide.

## Netlify and Cloudflare Pages

The ready-to-use configuration is
[`deployment/netlify/_headers`](../deployment/netlify/_headers). The production
build emits the same policy as `_headers` at the root of
`apps/geometry-editor/dist/`, which is the location understood by both Netlify
and Cloudflare Pages.

Set the publish/output directory to `apps/geometry-editor/dist`. No separate
dashboard header rules are needed when the platform consumes the included
`_headers` file.

## nginx

[`deployment/nginx.conf`](../deployment/nginx.conf) is an include-ready header
snippet. Include it in the `server` block that serves the built site, for
example:

```nginx
server {
    listen 443 ssl;
    server_name community.example.com;
    root /srv/vulcan-community;

    include /etc/nginx/snippets/vulcan-community-headers.conf;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Copy the repository snippet to the include path shown above, or change the
`include` path to its installed location. Reload nginx after validating the
configuration with `nginx -t`. If another nginx `location` adds response
headers, nginx stops inheriting `add_header` values from the parent; include the
Vulcan snippet in that location as well.

Static hosts that cannot set custom response headers cannot provide FHS
preflight. Use a host or reverse proxy that lets you configure COOP and COEP.

## Verify the deployment

First confirm the response headers from outside the browser:

```bash
curl -I https://community.example.com/
```

The response must contain the three `Cross-Origin-*` headers and the production
`Content-Security-Policy` shown above. Check an asset URL as well if the host has
path-specific header rules.

Then open the deployed editor in Chromium and run this in DevTools:

```js
crossOriginIsolated === true
```

The result must be `true`. `typeof SharedArrayBuffer === 'function'` is a useful
second check. If either check fails, inspect the final document response after
redirects and confirm that no proxy, CDN, or platform rule removed or replaced
COOP or COEP.
