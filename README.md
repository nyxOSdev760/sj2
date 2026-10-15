# Saint Vicious

A web proxy built on [Scramjet](https://github.com/MercuryWorkshop/scramjet) 2, the
service-worker-based interception proxy from Mercury Workshop.

## Run it

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Then open <http://localhost:8080>. All options (transport, Wisp server,
history, search engine) are under **Settings**, the gear at the top right.

Set `PORT` (and optionally `HOST`) to change where it listens:

```sh
PORT=3000 npm start
```

Service workers only run in secure contexts, so when you deploy it anywhere other than
`localhost` it must be served over **HTTPS** (put it behind a reverse proxy such as Caddy or
nginx, and make sure WebSocket upgrades on `/wisp/` are forwarded).

## Tabs and history

Open as many tabs as you like with **+** in the tab strip (middle-click a tab to close it).
Each tab is its own proxied frame. Visited pages are saved to **History** (the clock button in
the toolbar), which you can search, open in the current tab (Ctrl/Cmd- or middle-click opens
a new tab), prune or clear. History is stored only in your browser's `localStorage` and can be
turned off under *Settings → Save history*.

The home screen has shortcuts to YouTube, TikTok, Discord and Twitch
(Ctrl/Cmd- or middle-click opens one in a new tab). They're plain buttons in
`public/index.html`, so edit that list to change them. Icons are from
[Simple Icons](https://simpleicons.org) (CC0).

## Ad and tracker blocking (AdGuard DNS)

Hostnames are checked against [AdGuard DNS](https://adguard-dns.io/en/public-dns.html)
(`94.140.14.14`, `94.140.15.15`), which answers `0.0.0.0` for ad and tracker domains, so
those requests are blocked at lookup time and never connect:

- **In the browser** (works on static hosts too): before the proxy opens a request or
  WebSocket, it looks the hostname up over DNS-over-HTTPS at `dns.adguard-dns.com` (AdGuard's
  DoH endpoint on those same addresses), sent through the proxy's own transport. Blocked
  hosts get a "Blocked by AdGuard DNS" response. Answers are cached for 10 minutes; if
  AdGuard can't be reached, requests go through unfiltered rather than breaking the page.
  Blocking is always on. See `public/adblock.js`.
- **On the Node server**: the Wisp server resolves every hostname with `94.140.14.14` and
  `94.140.15.15` directly, and refuses connections that resolve to `0.0.0.0`. Set
  `DNS_SERVERS` to a comma-separated list to use other resolvers, or to an empty string for
  the system resolver:

  ```sh
  DNS_SERVERS=1.1.1.1,1.0.0.1 npm start   # other resolvers
  DNS_SERVERS= npm start                  # system resolver
  ```

## Static hosting

sj2 can also run with no backend at all, on GitHub Pages, Netlify, Cloudflare Pages, Vercel
or any plain file host, including from a subpath like `https://you.github.io/sj2/`.
A static host can't run the Wisp server, so the browser connects to an external one instead.

```sh
npm install
npm run build                                   # uses wss://wisp.mercurywork.shop/
WISP_URL=wss://wisp.example.com/ npm run build  # or your own Wisp server
```

Upload the generated `dist/` folder. Visitors can also point the site at a different Wisp
server under **Settings → Wisp server** (saved in their browser).

**GitHub Pages:** the included workflow (`.github/workflows/pages.yml`) builds and deploys on
every push to `master`. Turn it on once under *Settings → Pages → Build and deployment →
Source: GitHub Actions*. To use your own Wisp server, add a repository variable named
`WISP_URL` (*Settings → Secrets and variables → Actions → Variables*).

**Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, output directory
`dist`, and set the `WISP_URL` environment variable if you want a different Wisp server.

To host your own Wisp server, run this project's Node server (`npm start`, which serves one on
`/wisp/`) or `npx -p @mercuryworkshop/wisp-js wisp-js-server` anywhere that accepts WebSockets.
The default public server is run by a third party, so it can see which hosts you connect
to (not the contents of HTTPS pages, since TLS is end-to-end) and may go down or rate-limit you.

## How it works

| Piece | Where |
| --- | --- |
| Static site (UI, tabs, history, `sw.js`, `config.js`) | `public/` |
| AdGuard DNS filter wrapped around the transport | `public/adblock.js` |
| Scramjet 2 runtime + wasm rewriter | `/scramjet/` → `@mercuryworkshop/scramjet` |
| Scramjet 2 controller (page API, inject script, SW router) | `/controller/` → `@mercuryworkshop/scramjet-controller` |
| Transports (encrypted end-to-end over Wisp) | `/libcurl/`, `/epoxy/` |
| Wisp server (TCP over WebSocket) | `/wisp/` → `@mercuryworkshop/wisp-js` (Node server only) |

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
- The logo font is [Fruktur](https://github.com/SorkinType/Fruktur), served from
  `public/fonts/` under the SIL Open Font License (`public/fonts/fruktur-OFL.txt`).
