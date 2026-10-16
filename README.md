# Skyline

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
Each tab is its own proxied frame. Visited pages are saved to **History** (in the ☰ menu),
which you can search, open in the current tab (Ctrl/Cmd- or middle-click opens
a new tab), prune or clear. History is stored only in your browser's `localStorage` and can be
turned off under *Settings → Save history*.

The home screen has shortcut tiles (YouTube, TikTok, Discord, Twitch and Music (Tidal) to start). Tap **Add**
to pin any site, the trash can to remove one, or use **☰ → Bookmark this page** while browsing.
Ctrl/Cmd- or middle-click opens a shortcut in a new tab. Shortcuts are saved in your browser;
*Settings → Home shortcuts → Reset to defaults* brings the originals back. Brand icons are from
[Simple Icons](https://simpleicons.org) (CC0); other sites get a letter tile.

The default theme is **Lavender**, a soft cool light theme; *Settings → Theme* switches to
**AMOLED dark**. The home screen wallpaper is set under *Settings → Wallpaper*: **Clouds** (a photo, the
default), **Snow** (animated snowfall) or **Night sky** (an animated constellation). The
animations pause while a page is open or the tab is hidden, and stay still for people who
prefer reduced motion.

The **☰ menu** has History, Bookmark this page, Open outside the proxy and Take the tour. The
address bar shows `skyline://home` on the home screen; `skyline://history` and `skyline://settings`
open those panels. A five-step welcome tour shows on the first visit.

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

Skyline can also run with no backend at all, on GitHub Pages, Netlify, Cloudflare Pages, Vercel
or any plain file host, including from a subpath like `https://you.github.io/sj2/`.
A static host can't run the Wisp server, so the browser connects to external ones instead.

```sh
npm install
npm run build                                          # uses the list in public/config.js
WISP_URL=wss://wisp.example.com/,other.example npm run build  # or your own list
```

Upload the generated `dist/` folder. Visitors can also point the site at a different Wisp
server under **Settings → Wisp server** (saved in their browser); the built-in list stays as
the fallback if it stops responding.

**GitHub Pages:** the included workflow (`.github/workflows/pages.yml`) builds and deploys on
every push to `master`. Turn it on once under *Settings → Pages → Build and deployment →
Source: GitHub Actions*. To use your own Wisp servers, add a repository variable named
`WISP_URL` with a comma-separated list (*Settings → Secrets and variables → Actions →
Variables*).

**Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, output directory
`dist`, and set the `WISP_URL` environment variable if you want different Wisp servers.

To host your own Wisp server, run this project's Node server (`npm start`, which serves one on
`/wisp/`) or `npx -p @mercuryworkshop/wisp-js wisp-js-server` anywhere that accepts WebSockets.
The public servers in the default list are run by third parties, so they can see which hosts
you connect to (not the contents of HTTPS pages, since TLS is end-to-end) and may go down or
rate-limit you.

## Wisp server fallback

`public/config.js` lists the Wisp servers (`wispServers`). Entries are a host (tried at both
`/wisp/` and `/`), a full `ws://`/`wss://` URL, or `self` for the Node server's own `/wisp/`.

- **On open**, every server is probed in parallel and the fastest one that answers like a real
  Wisp server is used (Settings shows which: *Automatic · using …*). A server typed into
  Settings is tried first.
- **While browsing**, if a request fails, the current server is health-checked. If it's down,
  the next fastest server takes over without a reload, and the failed page load is retried.
  If the server is fine, the site itself failed and nothing changes.
- See `public/wisp.js`.

## How it works

| Piece | Where |
| --- | --- |
| Static site (UI, tabs, history, `sw.js`, `config.js`) | `public/` |
| Shortcuts, animated wallpapers, welcome tour | `public/home.js`, `public/tour.js` |
| AdGuard DNS filter wrapped around the transport | `public/adblock.js` |
| Wisp server picking and failover | `public/wisp.js` |
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
- The logo font is [Outfit](https://github.com/Outfitio/Outfit-Fonts), served from
  `public/fonts/` under the SIL Open Font License (`public/fonts/outfit-OFL.txt`).
