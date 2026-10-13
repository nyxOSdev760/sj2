# sj2

A web proxy built on [Scramjet](https://github.com/MercuryWorkshop/scramjet) 2, the
service-worker-based interception proxy from Mercury Workshop.

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Then open <http://localhost:8080>. Set `PORT` (and optionally `HOST`) to change where it listens:

```sh
PORT=3000 npm start
```

Service workers only run in secure contexts, so when you deploy it anywhere other than
`localhost` it must be served over **HTTPS** (put it behind a reverse proxy such as Caddy or
nginx, and make sure WebSocket upgrades on `/wisp/` are forwarded).

## How it works

| Piece | Where |
| --- | --- |
| Static site (UI, `sw.js`) | `public/` |
| Scramjet 2 runtime + wasm rewriter | `/scramjet/` → `@mercuryworkshop/scramjet` |
| Scramjet 2 controller (page API, inject script, SW router) | `/controller/` → `@mercuryworkshop/scramjet-controller` |
| Transports (encrypted end-to-end over Wisp) | `/libcurl/`, `/epoxy/` |
| Wisp server (TCP over WebSocket) | `/wisp/` → `@mercuryworkshop/wisp-js` |

1. `public/app.js` registers `sw.js`, loads Scramjet and the controller, and creates a
   transport (libcurl by default, epoxy selectable under *Settings*).
2. A `Controller` is created and attached to the page's `<iframe>`; `frame.go(url)` navigates it.
3. Requests from the iframe hit the service worker, which hands them to the controller to be
   rewritten and fetched through the transport. TLS is terminated in the browser, and the
   server only relays raw TCP over Wisp.

The Wisp server refuses connections to private and loopback addresses so the proxy
can't be used to reach the host's own network.

## Notes

- Scramjet 2 is still published as an alpha (`2.0.67-alpha.2`); the controller
  (`0.0.14`) checks the Scramjet version at runtime, so the two are pinned exactly in
  `package.json`. Upgrade them together.
- Licensed AGPL-3.0, matching the Scramjet 2 packages it serves.
