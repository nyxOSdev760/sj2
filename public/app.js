"use strict";
/* filler: c__o__d__e */
// Directory the app is served from: "/" normally, "/<repo>/" on GitHub Pages project
// sites. Everything is resolved against it so the app works from any subpath.
const BASE = new URL("./", location.href);
const path = (p) => new URL(p, BASE).pathname;

const PATHS = {
	sw: path("servy.js"),
	prefix: path("~/sj/"),
	// servy2: Arc4dia's engine, a fork of Scramjet (built by scripts/servy2.js).
	scramjet: path("servy2/servy2.js"),
	wasm: path("servy2/servy2.wasm"),
	controllerApi: path("servy2/servy2.api.js"),
	controllerInject: path("servy2/servy2.inject.js"),
	libcurl: path("libcurl/index.js"),
	epoxy: path("epoxy/index.js"),
};

const $ = (id) => document.getElementById(id);
const els = {
	tabs: $("tabs"),
	toolbar: $("toolbar"),
	home: $("home-screen"),
	browser: $("browser"),
	frames: $("frames"),
	bar: $("bar"),
	barForm: $("bar-form"),
	search: $("search"),
	searchForm: $("search-form"),
	status: $("status"),
	transport: $("transport"),
	wisp: $("wisp"),
	engine: $("engine"),
	saveHistory: $("save-history"),
	settingsStatus: $("settings-status"),
	historyPanel: $("history-panel"),
	barIcon: $("bar-icon"),
	shortcuts: $("shortcuts"),
	shortcutPanel: $("shortcut-panel"),
	shortcutForm: $("shortcut-form"),
	shortcutName: $("shortcut-name"),
	shortcutUrl: $("shortcut-url"),
	shortcutError: $("shortcut-error"),
	menu: $("menu"),
	menuButton: $("menu-button"),
	theme: $("theme"),
	historySearch: $("history-search"),
	historyList: $("history-list"),
};

const settings = {
	get(key, fallback) {
		try {
			return localStorage.getItem("sj2:" + key) ?? fallback;
		} catch {
			return fallback;
		}
	},
	set(key, value) {
		try {
			localStorage.setItem("sj2:" + key, value);
		} catch {
			// storage unavailable; setting just won't persist
		}
	},
	remove(key) {
		try {
			localStorage.removeItem("sj2:" + key);
		} catch {
			// storage unavailable
		}
	},
};

// Visited pages, newest first, kept in this browser only. Each URL appears once.
const browsingHistory = {
	max: 1000,
	entries: [],
	load() {
		try {
			const parsed = JSON.parse(settings.get("history", "[]"));
			this.entries = Array.isArray(parsed) ? parsed : [];
		} catch {
			this.entries = [];
		}
	},
	save() {
		settings.set("history", JSON.stringify(this.entries));
	},
	add(url, title) {
		if (!els.saveHistory.checked) return;
		const existing = this.entries.findIndex((e) => e.url === url);
		const previous = existing === -1 ? null : this.entries.splice(existing, 1)[0];
		this.entries.unshift({ url, title: title || previous?.title || "", time: Date.now() });
		this.entries.length = Math.min(this.entries.length, this.max);
		this.save();
	},
	setTitle(url, title) {
		const entry = this.entries.find((e) => e.url === url);
		if (!els.saveHistory.checked || !entry || !title || entry.title === title) return;
		entry.title = title;
		this.save();
	},
	remove(url) {
		this.entries = this.entries.filter((e) => e.url !== url);
		this.save();
	},
	clear() {
		this.entries = [];
		settings.remove("history");
	},
};

function setStatus(text, isError = false) {
	for (const status of [els.status, els.settingsStatus]) {
		status.textContent = text;
		status.classList.toggle("error", isError);
	}
}

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("Failed to load " + src));
		document.head.appendChild(script);
	});
}

async function registerServiceWorker(path) {
	const reg = await navigator.serviceWorker.register(path, { type: "classic", updateViaCache: "none" });
	await navigator.serviceWorker.ready;
	if (reg.active) return reg.active;

	const worker = reg.installing || reg.waiting;
	if (!worker) throw new Error("No service worker found in registration");
	await new Promise((resolve) => {
		if (worker.state === "activated") return resolve();
		worker.addEventListener("statechange", () => {
			if (worker.state === "activated") resolve();
		});
	});
	return reg.active;
}

const transportScripts = new Set();
// Epoxy loads its WebAssembly on the first init(). Two inits at once load it twice, and the
// first client is left pointing at the replaced copy (requests then fail with garbage
// errors), so epoxy clients start one at a time.
let epoxyInits = Promise.resolve();
async function createTransport(name, wisp) {
	if (name === "epoxy") {
		if (!transportScripts.has(name)) await loadScript(PATHS.epoxy);
		transportScripts.add(name);
		const transport = new EpoxyTransport.default({ wisp });
		const init = transport.init.bind(transport);
		let starting = null; // calls made while it starts share that start
		transport.init = () => {
			starting ??= epoxyInits = epoxyInits.then(init, init);
			starting.catch(() => (starting = null));
			return starting;
		};
		return transport;
	}
	if (!transportScripts.has("libcurl")) await loadScript(PATHS.libcurl);
	transportScripts.add("libcurl");
	return new LibcurlTransport.LibcurlClient({ wisp });
}

// Every transport is wrapped so ad and tracker hosts are checked against AdGuard DNS.
async function connectWisp(url) {
	return AdGuardDNS.wrap(await createTransport(els.transport.value, url));
}

// Picks the Wisp server to use: a server typed into Settings if it answers, otherwise the
// fastest of config.js's list, skipping servers in `exclude` that already went down.
async function pickWisp(exclude = new Set()) {
	const custom = els.wisp.value.trim();
	const own = custom ? WispPool.expand(custom).filter((url) => !exclude.has(url)) : [];
	if (own.length) {
		try {
			return await WispPool.fastest(own);
		} catch {
			console.warn(`Wisp server ${custom} isn't responding; trying the built-in list.`);
		}
	}
	// The built-in list is in order of preference: the first server that answers is used.
	const entries = self.SJ2_CONFIG?.wispServers ?? ["self"];
	if (WispPool.expandAll(entries).every((url) => exclude.has(url))) {
		exclude.clear(); // every server has failed once; give them all another chance
	}
	for (const entry of entries) {
		const urls = WispPool.expand(entry).filter((url) => !exclude.has(url));
		if (!urls.length) continue;
		try {
			return await WispPool.fastest(urls); // an entry can be two URLs (/wisp/ and /)
		} catch {
			// not answering; try the next one
		}
	}
	throw new Error("None of the Wisp servers responded");
}

// Backup routes for sites that fail on the main connection: epoxy (a different TLS
// engine) on the current server, then on the next healthiest servers. Epoxy clients
// each keep their own connection, so several servers can be used at once.
let healthyServers = [];
const epoxyClients = new Map();
async function alternativeRoutes(failover) {
	// Servers that answered at start first, then the rest of the list (a free server that
	// was asleep then may be up by now).
	const configured = WispPool.expandAll(self.SJ2_CONFIG?.wispServers ?? []);
	const urls = [...new Set([failover.url, ...healthyServers, ...configured])].filter(
		(u) => u === failover.url || !failover.dead.has(u)
	);
	const routes = [];
	const servers = new Set(); // one route per server, even when it answers on two paths
	for (const url of urls) {
		const server = new URL(url).host;
		if (servers.has(server)) continue;
		servers.add(server);
		if (url === failover.url && els.transport.value === "epoxy") continue; // that's the main route
		if (!epoxyClients.has(url)) epoxyClients.set(url, AdGuardDNS.wrap(await createTransport("epoxy", url)));
		routes.push(epoxyClients.get(url));
		if (routes.length === 3) break;
	}
	return routes;
}

// Free hosts (like Render) sleep when idle and take a while to wake. A plain request
// wakes them while the rest of the site starts, so they're ready as backup routes.
function wakeServers() {
	const origins = WispPool.expandAll(self.SJ2_CONFIG?.wispServers ?? []).map(
		(url) => new URL(url.replace(/^ws/, "http")).origin
	);
	for (const origin of new Set(origins)) {
		if (origin === location.origin) continue;
		fetch(origin + "/", { mode: "no-cors", cache: "no-store" }).catch(() => {});
	}
}

function showWisp(url) {
	els.wisp.placeholder = "Automatic";
	$("wisp-using").textContent = "Using " + WispPool.label(url).replace(/\/wisp$/, "");
}

async function boot() {
	if (!("serviceWorker" in navigator)) {
		throw new Error(
			"Service workers are unavailable. Open this site over HTTPS or on localhost (and not in a private window on Firefox)."
		);
	}
	/* filler: c__o__d__e */
	wakeServers();
	const sw = await registerServiceWorker(PATHS.sw);
	await loadScript(PATHS.scramjet);
	await loadScript(PATHS.controllerApi);

	let url;
	try {
		url = await pickWisp();
	} catch (err) {
		// Nothing answered the probe; start with the first server anyway, and failover
		// keeps trying the others once requests are made.
		console.warn(err);
		url = WispPool.expandAll(self.SJ2_CONFIG?.wispServers ?? ["self"])[0];
	}
	showWisp(url);
	const failover = new WispPool.FailoverTransport({
		url,
		transport: await connectWisp(url),
		connectTo: connectWisp,
		pick: pickWisp,
		onSwitch: (from, to) => {
			showWisp(to);
			setStatus(`${WispPool.label(from)} stopped responding, switched to ${WispPool.label(to)}.`);
		},
		alternatives: () => alternativeRoutes(failover),
	});
	// In the background, find every server that answers and start the backup routes, so
	// they're ready to race from the first site.
	WispPool.healthy(WispPool.expandAll(self.SJ2_CONFIG?.wispServers ?? ["self"]))
		.then((list) => {
			healthyServers = list;
			return alternativeRoutes(failover);
		})
		.then((routes) => Promise.all(routes.map((route) => route.ready || route.init())))
		.catch((err) => console.warn("Backup routes didn't start:", err));

	const { Controller, config } = $scramjetController;
	config.prefix = PATHS.prefix;
	config.scramjetPath = PATHS.scramjet;
	config.wasmPath = PATHS.wasm;
	config.injectPath = PATHS.controllerInject;

	const controller = new Controller({ serviceworker: sw, transport: failover });
	await controller.wait();
	return { controller, failover };
}

function toUrl(input) {
	const value = input.trim();
	if (!value) return null;
	if (/^https?:\/\//i.test(value)) return value;
	// "example.com", "example.com/path", "localhost:3000" without spaces -> treat as a URL
	if (!/\s/.test(value) && /^[^/]+\.[^/.]{2,}(\/|:|$)/.test(value)) {
		try {
			return new URL("https://" + value).href;
		} catch {
			// fall through to search
		}
	}
	return els.engine.value.replace("%s", encodeURIComponent(value));
}

// Turns a tab's proxied location back into the real URL it points at.
function currentRealUrl(tab) {
	try {
		const href = tab.iframe.contentWindow.location.href;
		const prefix = new URL(tab.frame.prefix, location.href).href;
		if (!href.startsWith(prefix)) return null;
		// The real URL is fully percent-encoded, so a literal "?" starts Scramjet's
		// own "$"-params and a literal "#" is the page's current hash.
		const rest = href.slice(prefix.length);
		const end = rest.search(/[?#]/);
		const encoded = end === -1 ? rest : rest.slice(0, end);
		const hashAt = rest.indexOf("#");
		const hash = hashAt === -1 ? "" : rest.slice(hashAt);
		return $scramjetController.config.codec.decode(encoded) + hash;
	} catch {
		return null;
	}
}

function currentTitle(tab) {
	try {
		return tab.iframe.contentDocument?.title.trim() || "";
	} catch {
		return "";
	}
}

// Internal pages shown in the address bar, e.g. the home screen.
const HOME_URL = "arc4dia://home";
const PAGES = ["settings", "games"];
const PAGE_TITLES = { settings: "Settings", games: "Games" };
const INTERNAL = /^(?:arc4dia|skeld|skyline):\/\/(\w+)\/?$/i; // older names still work

const BAR_ICONS = {
	home: "M3 11l9-7 9 7M5 10v10h14V10",
	lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
	globe:
		"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
	settings:
		"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
	games:
		"M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-3.96 3.43l-.9 6.32a2.5 2.5 0 0 0 4.5 1.85L8 15h8l1.66 1.6a2.5 2.5 0 0 0 4.5-1.85l-.9-6.32A4 4 0 0 0 17.3 5z",
	movies: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
	music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
};

// A tab's icon: the site's logo when it's a known brand, otherwise a line icon for the
// page (home, settings, games, movies, music) or a globe.
function tabIcon(tab) {
	const brand = tab.url && !isMovies(tab.url) && !isMusic(tab.url) && Shortcuts.brandIcon(tab.url);
	if (brand) return brand;
	const name = tab.page || (!tab.url ? "home" : isMovies(tab.url) ? "movies" : isMusic(tab.url) ? "music" : "globe");
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("line-icon");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", BAR_ICONS[name] ?? BAR_ICONS.globe);
	svg.append(path);
	return svg;
}

// Movies is movy.sx, but the address bar, tabs and history call it arc4dia://movies.
const MOVIES_URL = "https://www.movy.sx/";
const MOVIES_HOST = "movy.sx";
function isMovies(url) {
	try {
		const host = new URL(url).hostname;
		return host === MOVIES_HOST || host.endsWith("." + MOVIES_HOST);
	} catch {
		return false;
	}
}
// What the address bar shows for `url`.
// Music is Ripple (GalaxyV7's music app), shown as arc4dia://music the same way.
const MUSIC_URL = "https://galxy.it.com/ripple/";
function isMusic(url) {
	try {
		const u = new URL(url);
		return u.hostname === "galxy.it.com" && u.pathname.startsWith("/ripple");
	} catch {
		return false;
	}
}
function shownUrl(url) {
	return isMovies(url) ? "arc4dia://movies" : isMusic(url) ? "arc4dia://music" : url;
}

// The loading screen over a proxied page: an animated Arc4dia mark, the site, a progress
// bar and an assets count. Progress comes from the page itself (document state, files
// fetched, images finished); the page stays hidden until it's usable and the images in
// view are in, then fades in. Links clicked inside the page start it too. A page that
// never finishes is shown after 12 seconds anyway.
class PageLoader {
	constructor(container, iframe) {
		this.iframe = iframe;
		this.el = el("div", "page-loader");
		this.el.hidden = true;
		const mark = el("div", "loader-mark");
		mark.append(el("span", "loader-ring"), el("span", "loader-letter", "A"));
		this.site = el("p", "loader-site");
		const track = el("div", "loader-track");
		this.bar = el("div", "loader-bar");
		track.append(this.bar);
		this.meta = el("p", "loader-meta");
		this.el.append(mark, this.site, track, this.meta);
		container.append(this.el);
		this.visible = true;
		this.loading = false;
		iframe.addEventListener("load", () => this.watchLeaving());
	}
	// Starts the loader when the page in the frame begins navigating away.
	watchLeaving() {
		try {
			const win = this.iframe.contentWindow;
			if (!win.location.href.includes("/~/sj/") || win.__arcWatched) return;
			win.__arcWatched = true;
			win.addEventListener("beforeunload", () => this.start(this.label));
		} catch {}
	}
	start(label) {
		this.label = label;
		// A page that leaves again right after showing (bot checks reload themselves) keeps
		// showing instead of going back under the loading screen.
		this.quick = !this.loading && performance.now() - (this.shownAt ?? -1e9) < 2500 ? (this.quick ?? 0) + 1 : 0;
		if (this.quick >= 2) return;
		this.site.textContent = label ? `Loading ${label}` : "Loading…";
		if (!this.loading) {
			this.p = 0;
			this.t0 = performance.now();
		}
		try {
			this.oldDoc = this.iframe.contentDocument; // the page being left, if any
		} catch {
			this.oldDoc = null;
		}
		this.loading = true;
		this.el.classList.remove("leaving");
		this.iframe.classList.add("page-hidden");
		this.meta.textContent = "Connecting…";
		this.render();
		this.sync();
		clearInterval(this.timer);
		this.timer = setInterval(() => this.tick(), 120);
	}
	tick() {
		let state = "loading";
		let total = 0;
		let done = 0;
		let files = 0;
		try {
			const win = this.iframe.contentWindow;
			const doc = win.document;
			if (doc !== this.oldDoc && win.location.href.includes("/~/sj/")) {
				state = doc.readyState;
				// Only images on screen; the rest of the page can keep loading behind it.
				const images = [...doc.images].filter((img) => {
					if (!img.src || !img.getClientRects().length) return false;
					const box = img.getBoundingClientRect();
					return box.top < win.innerHeight && box.bottom > 0 && box.left < win.innerWidth && box.right > 0;
				});
				total = images.length;
				done = images.filter((img) => img.complete).length;
				files = win.performance.getEntriesByType("resource").length;
			}
		} catch {}
		const elapsed = performance.now() - this.t0;
		let target;
		if (state === "loading") target = 6 + Math.min(40, files * 1.5);
		else if (state === "interactive") target = 50 + (total ? (35 * done) / total : 25);
		else target = 88 + (total ? (12 * done) / total : 12);
		this.p += (Math.min(target, 99.5) - this.p) * 0.3;
		// Shown once the page is usable and the pictures in view are in; the rest of the page
		// (below the fold, trackers, late scripts) keeps loading behind it.
		const imagesIn = done >= total;
		if ((state === "complete" && (imagesIn || elapsed > 5000)) || (state === "interactive" && imagesIn && elapsed > 600)) {
			this.p = 100;
		}
		this.meta.textContent =
			state === "loading" && !files
				? "Connecting…"
				: `${Math.round(this.p)}%  ·  ${total ? `${done} of ${total} images` : `${files} files`}`;
		this.render();
		if (this.p >= 100 || elapsed > 12000) this.finish();
	}
	render() {
		this.bar.style.width = this.p + "%";
	}
	finish() {
		if (!this.loading) return;
		clearInterval(this.timer);
		this.loading = false;
		this.shownAt = performance.now();
		this.p = 100;
		this.render();
		this.iframe.classList.remove("page-hidden");
		this.iframe.classList.add("page-reveal");
		setTimeout(() => this.iframe.classList.remove("page-reveal"), 600);
		this.el.classList.add("leaving");
		setTimeout(() => {
			this.el.classList.remove("leaving");
			this.sync();
		}, 350);
	}
	cancel() {
		clearInterval(this.timer);
		this.loading = false;
		this.iframe.classList.remove("page-hidden");
		this.sync();
	}
	setVisible(visible) {
		this.visible = visible;
		this.sync();
	}
	sync() {
		this.el.hidden = !(this.loading || this.el.classList.contains("leaving")) || !this.visible;
	}
	destroy() {
		clearInterval(this.timer);
		this.el.remove();
	}
}

// What the loader calls a site: "Movies", "Music" or its hostname.
function siteLabel(url) {
	return isMovies(url) ? "Movies" : isMusic(url) ? "Music" : hostOf(url);
}

function setBarIcon(url) {
	const name = !url || isMovies(url) || isMusic(url) ? "home" : url.startsWith("https:") ? "lock" : "globe";
	els.barIcon.firstElementChild.setAttribute("d", BAR_ICONS[name]);
	els.barIcon.classList.toggle("secure", name === "lock");
}

// "youtube.com" or "https://youtube.com/x" -> absolute http(s) URL, or null.
function normalizeUrl(value) {
	value = value.trim();
	if (!value) return null;
	try {
		const url = new URL(/^[a-z][\w+.-]*:/i.test(value) ? value : "https://" + value);
		return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.href : null;
	} catch {
		return null;
	}
}

function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

function dayLabel(time) {
	const date = new Date(time);
	const today = new Date();
	const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
	if (date.toDateString() === today.toDateString()) return "Today";
	if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
	return date.toLocaleDateString(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
	});
}

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

async function main() {
	els.transport.value = settings.get("transport", "libcurl");
	els.wisp.placeholder = "Automatic";
	els.wisp.value = settings.get("wisp", "");
	// Startpage blocks proxy traffic and the default is now DuckDuckGo's HTML version, so
	// a saved Startpage or the old DuckDuckGo default moves to it.
	const savedEngine = settings.get("engine", "");
	const oldDefault = /startpage\.com|^https:\/\/duckduckgo\.com\/\?q=%s$/.test(savedEngine);
	els.engine.value = savedEngine && !oldDefault ? savedEngine : els.engine.options[0].value;
	if (!els.engine.value) els.engine.value = els.engine.options[0].value;
	if (!els.engine.value) els.engine.selectedIndex = 0;
	els.saveHistory.checked = settings.get("saveHistory", "1") === "1";
	browsingHistory.load();
	/* filler: c__o__d__e */
	let proxy;
	const ready = boot().then(
		(result) => {
			proxy = result;
			setStatus("");
			return result;
		},
		(err) => {
			console.error(err);
			setStatus("Proxy failed to start: " + err.message, true);
			throw err;
		}
	);
	ready.catch(() => {}); // already reported in the status line

	// Each tab gets its own iframe and Scramjet frame, created on its first navigation.
	// A tab with no url shows the home screen.
	const tabs = [];
	let activeTab = null;

	// DuckDuckGo's HTML version has no reliable dark theme, so its page is shown inverted.
	function styleFrame(tab) {
		let host = "";
		try {
			host = new URL(tab.url).hostname;
		} catch {}
		let challenge = false; // its "select the ducks" check needs real colors
		try {
			challenge = /bots use DuckDuckGo/i.test(tab.iframe.contentDocument.body.innerText);
		} catch {}
		tab.iframe?.classList.toggle("force-dark", /^(html|lite)\.duckduckgo\.com$/.test(host) && !challenge);
	}

	function updateTabLabel(tab) {
		styleFrame(tab);
		const text = tab.page
			? PAGE_TITLES[tab.page]
			: !tab.url
				? "Home"
				: isMovies(tab.url)
					? "Movies"
					: isMusic(tab.url)
						? "Music"
					: tab.title || hostOf(tab.url);
		tab.label.textContent = text;
		tab.el.title = tab.url ? `${text}\n${shownUrl(tab.url)}` : text;
		const favicon = tab.page || !tab.url ? null : faviconOf(tab);
		const key = (tab.page || (tab.url ? hostOf(tab.url) : "home")) + "|" + (favicon ?? "");
		if (tab.iconKey !== key) {
			tab.iconKey = key;
			const fallback = tabIcon(tab);
			if (!favicon) tab.icon.replaceChildren(fallback);
			else {
				// The site's own icon, loaded through the proxy; the line icon until it's in.
				const img = el("img");
				img.alt = "";
				img.onload = () => tab.iconKey === key && tab.icon.replaceChildren(img);
				img.src = favicon;
				if (!tab.icon.firstChild) tab.icon.replaceChildren(fallback);
			}
		}
	}

	// The proxied address of the page's icon: its <link rel="icon">, or /favicon.ico.
	function faviconOf(tab) {
		if (isMovies(tab.url) || isMusic(tab.url)) return null; // shown as Arc4dia apps
		try {
			const win = tab.iframe.contentWindow;
			const at = win.location.href.indexOf("/~/sj/");
			if (at < 0) return null;
			const prefix = win.location.href.slice(0, at + 6).concat(win.location.href.slice(at + 6).split("/").slice(0, 2).join("/"), "/");
			const links = [...win.document.querySelectorAll('link[rel~="icon" i]')];
			const best = links.find((l) => /\b(32|48|64)\b/.test(l.sizes?.value ?? "")) || links[0];
			const url = best?.href || new URL("/favicon.ico", tab.url).href;
			return /^https?:/.test(url) ? prefix + encodeURIComponent(url) : null;
		} catch {
			return null;
		}
	}

	function createTab({ activate = true } = {}) {
		// `page` is a built-in page (arc4dia://settings, arc4dia://games) shown instead of a site.
		const tab = { url: "", page: null, title: "", recordedUrl: null, iframe: null, frame: null, back: [], forward: [] };
		tab.el = el("div", "tab");
		tab.el.setAttribute("role", "tab");
		tab.el.tabIndex = 0;
		tab.icon = el("span", "tab-icon");
		tab.label = el("span", "tab-title");
		const close = el("button", "tab-close");
		close.title = "Close tab";
		close.setAttribute("aria-label", "Close tab");
		close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>';
		tab.el.append(tab.icon, tab.label, close);

		tab.el.addEventListener("click", (e) => {
			if (close.contains(e.target)) closeTab(tab);
			else selectTab(tab);
		});
		tab.el.addEventListener("auxclick", (e) => {
			if (e.button === 1) closeTab(tab);
		});
		tab.el.addEventListener("keydown", (e) => {
			if (e.target === tab.el && (e.key === "Enter" || e.key === " ")) {
				e.preventDefault();
				selectTab(tab);
			}
		});

		els.tabs.append(tab.el);
		tabs.push(tab);
		updateTabLabel(tab);
		if (activate) selectTab(tab);
		return tab;
	}

	function selectTab(tab) {
		activeTab = tab;
		for (const t of tabs) {
			const active = t === tab;
			t.el.classList.toggle("active", active);
			t.el.setAttribute("aria-selected", String(active));
			if (t.iframe) t.iframe.hidden = !active || !t.url;
			t.loader?.setVisible(active && !!t.url);
		}
		els.home.hidden = !!tab.url || !!tab.page;
		for (const name of PAGES) $("page-" + name).hidden = tab.page !== name;
		els.bar.value = tab.page ? "arc4dia://" + tab.page : tab.url ? shownUrl(tab.url) : HOME_URL;
		setBarIcon(tab.url);
		updateDock();
		updateNavButtons();
		$("fullscreen").disabled = !tab.url;
		tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
		if (!tab.url && !tab.page) {
			els.search.value = "";
			els.search.focus();
		}
	}

	function closeTab(tab) {
		const index = tabs.indexOf(tab);
		if (index === -1) return;
		tabs.splice(index, 1);
		tab.el.remove();
		if (tab.iframe) {
			tab.loader?.destroy();
			tab.iframe.remove();
			const frames = proxy.controller.frames;
			if (frames.includes(tab.frame)) frames.splice(frames.indexOf(tab.frame), 1);
		}
		if (!tabs.length) createTab();
		else if (tab === activeTab) selectTab(tabs[Math.min(index, tabs.length - 1)]);
	}

	// Back and forward: each tab keeps its own list of pages, and a step loads that page
	// again. (Every tab's frame shares the browser's history, so history.back() in one tab
	// could undo another tab's page, or leave Arc4dia altogether.)
	const entryOf = (tab) => (tab.page ? "arc4dia://" + tab.page : tab.url || HOME_URL);
	function record(tab, next) {
		if (next === entryOf(tab)) return; // same page again
		tab.back.push(entryOf(tab));
		if (tab.back.length > 100) tab.back.shift();
		tab.forward.length = 0;
		updateNavButtons();
	}
	function step(tab, dir) {
		const from = dir < 0 ? tab.back : tab.forward;
		if (!from.length) return;
		(dir < 0 ? tab.forward : tab.back).push(entryOf(tab));
		navigate(from.pop(), tab, { replace: true }).catch(() => {});
		updateNavButtons();
	}
	function updateNavButtons() {
		$("back").disabled = !activeTab?.back.length;
		$("forward").disabled = !activeTab?.forward.length;
	}

	// A page tidying its own URL with history.replaceState isn't a new page to go back to.
	function watchReplace(tab) {
		try {
			const win = tab.iframe.contentWindow;
			if (win.__arcReplace) return;
			win.__arcReplace = true;
			const replace = win.history.replaceState;
			win.history.replaceState = function (...args) {
				tab.replaced = true;
				return replace.apply(this, args);
			};
		} catch {
			// not a proxied page
		}
	}

	// Links a page opens in a new tab (target=_blank, Ctrl/Cmd-click, middle-click) open in a
	// new Arc4dia tab instead of a browser tab pointing at the proxy.
	function watchLinks(tab) {
		try {
			const doc = tab.iframe.contentDocument;
			if (!doc || doc.__arcLinks) return;
			doc.__arcLinks = true;
			const open = (e) => {
				const link = e.target.closest?.("a[href]");
				if (!link) return;
				const newTab = e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey || /^_blank$/i.test(link.target);
				const url = link.href;
				if (!newTab || !/^https?:/.test(url) || (e.type === "click" && e.button !== 0)) return;
				e.preventDefault();
				e.stopImmediatePropagation();
				const opened = createTab({ activate: !(e.ctrlKey || e.metaKey || e.button === 1) });
				navigate(url, opened).catch(() => {});
			};
			doc.addEventListener("click", open, true);
			doc.addEventListener("auxclick", open, true);
			// Esc inside the page leaves full screen too.
			doc.addEventListener("keydown", (e) => e.key === "Escape" && document.body.classList.remove("fullpage"));
		} catch {
			// not a proxied page
		}
	}

	function goHome(tab, { replace = false } = {}) {
		if (!replace) record(tab, HOME_URL);
		tab.loader?.cancel();
		tab.url = "";
		tab.page = null;
		tab.title = "";
		tab.recordedUrl = null;
		if (tab.iframe) tab.iframe.src = "about:blank";
		updateTabLabel(tab);
		if (tab === activeTab) selectTab(tab);
	}

	function ensureFrame(tab) {
		if (tab.frame) return;
		tab.iframe = el("iframe");
		tab.iframe.title = "Proxied page";
		tab.iframe.hidden = true;
		els.frames.append(tab.iframe);
		tab.loader = new PageLoader(els.frames, tab.iframe);
		tab.loader.setVisible(tab === activeTab);
		tab.frame = proxy.controller.createFrame(tab.iframe);
		tab.iframe.addEventListener("load", () => {
			tab.pending = false;
			watchReplace(tab);
			watchLinks(tab);
			syncTab(tab);
			updateTabLabel(tab); // the page's icon is known now
		});
	}

	// `replace` leaves the tab's Back list alone (Back/Forward themselves, search retries).
	async function navigate(input, tab = activeTab, { replace = false } = {}) {
		const page = input.trim().match(INTERNAL)?.[1].toLowerCase();
		if (page) {
			if (page === "movies") return navigate(MOVIES_URL, tab, { replace });
			if (page === "music") return navigate(MUSIC_URL, tab, { replace });
			if (page === "history") openHistory();
			else if (PAGES.includes(page)) openPage(page, tab, { replace });
			else goHome(tab, { replace });
			return;
		}
		const url = toUrl(input);
		if (!url) return;
		// Remember searches, to re-run them elsewhere if the engine turns the proxy away.
		tab.searchQuery = url === els.engine.value.replace("%s", encodeURIComponent(input.trim())) ? input.trim() : null;
		if (!proxy) setStatus("Still starting, one moment…");
		await ready;
		if (!tabs.includes(tab)) return; // closed while the proxy was starting
		ensureFrame(tab);
		if (!replace) record(tab, url);
		// Until the new page loads, the frame may still report the page being left.
		tab.leaving = tab.url ? currentRealUrl(tab) : null;
		tab.pending = true;
		tab.page = null;
		tab.url = url;
		tab.title = "";
		tab.frame.go(url);
		tab.loader.start(siteLabel(url));
		updateTabLabel(tab);
		if (tab === activeTab) selectTab(tab);
	}

	// Reads a tab's real URL and title, including SPA navigations that never fire
	// "load", and records new URLs in history.
	// DuckDuckGo sometimes answers proxy traffic with an error page or a bot check.
	const FALLBACK_SEARCH = "https://www.bing.com/search?q=%s";
	function searchBlocked(tab, url) {
		if (!/(^|\.)duckduckgo\.com$/.test(hostOf(url))) return false;
		if (/\/static-pages\/home-error\//.test(url)) return true;
		try {
			return /bots use DuckDuckGo|If this persists, please email us/i.test(tab.iframe.contentDocument.body.innerText);
		} catch {
			return false;
		}
	}

	function syncTab(tab) {
		if (!tab.frame || !tab.url) return;
		const url = currentRealUrl(tab);
		if (tab.pending && url && url === tab.leaving) return;
		const title = currentTitle(tab);
		const changed = (url && url !== tab.url) || title !== tab.title;
		if (url) {
			// The page moved on by itself (a link, a redirect, an in-page route): that's a
			// step Back can return to, unless the page only replaced its URL.
			if (url !== tab.url && !tab.pending && !tab.replaced) record(tab, url);
			tab.replaced = false;
			tab.url = url;
			if (url !== tab.recordedUrl) {
				tab.recordedUrl = url;
				browsingHistory.add(shownUrl(url), isMovies(url) ? "Movies" : isMusic(url) ? "Music" : title);
			} else {
				browsingHistory.setTitle(url, title);
			}
		}
		tab.title = title;
		if (tab.searchQuery && url && searchBlocked(tab, url)) {
			const query = tab.searchQuery;
			tab.searchQuery = null;
			setStatus("DuckDuckGo turned the proxy away, so this search ran on Bing.");
			navigate(FALLBACK_SEARCH.replace("%s", encodeURIComponent(query)), tab, { replace: true }).catch(() => {});
			return;
		}
		if (changed) updateTabLabel(tab);
		if (changed && tab === activeTab) updateDock();
		if (tab === activeTab && document.activeElement !== els.bar && els.bar.value !== shownUrl(tab.url)) {
			els.bar.value = shownUrl(tab.url);
			setBarIcon(tab.url);
		}
	}
	setInterval(() => tabs.forEach(syncTab), 500);

	function renderHistory() {
		const query = els.historySearch.value.trim().toLowerCase();
		const matches = browsingHistory.entries.filter(
			(e) => !query || e.url.toLowerCase().includes(query) || e.title.toLowerCase().includes(query)
		);
		els.historyList.replaceChildren();
		if (!matches.length) {
			const message = query
				? "No matching pages."
				: els.saveHistory.checked
					? "Pages you visit will show up here."
					: "History is turned off in Settings.";
			els.historyList.append(el("p", "history-empty", message));
			return;
		}

		let day = null;
		let list;
		for (const entry of matches.slice(0, 500)) {
			const label = dayLabel(entry.time);
			if (label !== day) {
				day = label;
				list = el("ul");
				els.historyList.append(el("h3", null, label), list);
			}
			const item = el("li", "history-item");
			const open = el("button", "history-open");
			open.type = "button";
			open.title = entry.url;
			open.append(el("span", "history-title", entry.title || hostOf(entry.url)), el("span", "history-url", entry.url));
			const time = el(
				"time",
				"history-time",
				new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
			);
			time.dateTime = new Date(entry.time).toISOString();
			const remove = el("button", "icon history-remove", "×");
			remove.type = "button";
			remove.title = "Remove from history";
			remove.setAttribute("aria-label", "Remove from history");

			// Click opens in the current tab; Ctrl/Cmd-click or middle-click in a new one.
			open.addEventListener("click", (e) => {
				$("apps-panel").close();
				const tab = e.ctrlKey || e.metaKey ? createTab({ activate: false }) : activeTab;
				navigate(entry.url, tab).catch(() => {});
				if (tab === activeTab) els.historyPanel.close();
			});
			open.addEventListener("auxclick", (e) => {
				if (e.button === 1) navigate(entry.url, createTab({ activate: false })).catch(() => {});
			});
			remove.addEventListener("click", () => {
				browsingHistory.remove(entry.url);
				renderHistory();
			});
			item.append(open, time, remove);
			list.append(item);
		}
	}
	/* filler: c__o__d__e */
	function openHistory() {
		els.historySearch.value = "";
		renderHistory();
		els.historyPanel.showModal();
		els.historySearch.focus();
	}

	els.searchForm.addEventListener("submit", (e) => {
		e.preventDefault();
		navigate(els.search.value).catch(() => {});
	});
	els.barForm.addEventListener("submit", (e) => {
		e.preventDefault();
		navigate(els.bar.value).catch(() => {});
		els.bar.blur();
	});

	$("add-tab").addEventListener("click", () => createTab());
	$("back").addEventListener("click", () => step(activeTab, -1));
	$("forward").addEventListener("click", () => step(activeTab, 1));
	$("reload").addEventListener("click", () => activeTab.url && activeTab.frame?.reload());
	$("home").addEventListener("click", () => goHome(activeTab));
	$("history-button").addEventListener("click", () => openHistory());
	// Full screen: just the page, no bars. Esc (or leaving full screen) brings them back.
	$("fullscreen").addEventListener("click", () => {
		if (!activeTab.url) return;
		document.body.classList.add("fullpage");
		document.documentElement.requestFullscreen?.().catch(() => {});
	});
	document.addEventListener("fullscreenchange", () => {
		if (!document.fullscreenElement) document.body.classList.remove("fullpage");
	});
	addEventListener("keydown", (e) => {
		if (e.key === "Escape" && document.body.classList.contains("fullpage")) document.body.classList.remove("fullpage");
	});

	// Built-in pages (arc4dia://settings, arc4dia://games): shown in a tab like any site. One
	// opens in the tab it's asked for if that's a new tab, in the tab already showing it,
	// or in a new tab.
	function openPage(name, tab = activeTab, { replace = false } = {}) {
		// A Back or Forward step always stays in its own tab.
		const target = replace || (tab && !tab.url && !tab.page) ? tab : tabs.find((t) => t.page === name) || createTab();
		if (!replace) record(target, "arc4dia://" + name);
		target.loader?.cancel();
		if (target.iframe) target.iframe.src = "about:blank";
		target.url = "";
		target.title = "";
		target.recordedUrl = null;
		target.page = name;
		if (name === "games") renderGamesPage();
		updateTabLabel(target);
		selectTab(target);
	}

	// Game sites shown on arc4dia://games, opened through the proxy like any other site.
	// Cards are drawn in each site's color with its logo (Simple Icons, CC0) or a letter.
	const GAME_SITES = [
		{
			name: "itch.io",
			url: "https://itch.io/games/free/platform-web",
			about: "Free indie games that play in the browser",
			color: "#fa5c5c",
			logo: "M3.13 1.338C2.08 1.96.02 4.328 0 4.95v1.03c0 1.303 1.22 2.45 2.325 2.45 1.33 0 2.436-1.102 2.436-2.41 0 1.308 1.07 2.41 2.4 2.41 1.328 0 2.362-1.102 2.362-2.41 0 1.308 1.137 2.41 2.466 2.41h.024c1.33 0 2.466-1.102 2.466-2.41 0 1.308 1.034 2.41 2.363 2.41 1.33 0 2.4-1.102 2.4-2.41 0 1.308 1.106 2.41 2.435 2.41C22.78 8.43 24 7.282 24 5.98V4.95c-.02-.62-2.082-2.99-3.13-3.612-3.253-.114-5.508-.134-8.87-.133-3.362 0-7.945.053-8.87.133zm6.376 6.477a2.74 2.74 0 0 1-.468.602c-.5.49-1.19.795-1.947.795a2.786 2.786 0 0 1-1.95-.795c-.182-.178-.32-.37-.446-.59-.127.222-.303.412-.486.59a2.788 2.788 0 0 1-1.95.795c-.092 0-.187-.025-.264-.052-.107 1.113-.152 2.176-.168 2.95v.005l-.006 1.167c.02 2.334-.23 7.564 1.03 8.85 1.952.454 5.545.662 9.15.663 3.605 0 7.198-.21 9.15-.664 1.26-1.284 1.01-6.514 1.03-8.848l-.006-1.167v-.004c-.016-.775-.06-1.838-.168-2.95-.077.026-.172.052-.263.052a2.788 2.788 0 0 1-1.95-.795c-.184-.178-.36-.368-.486-.59-.127.22-.265.412-.447.59a2.786 2.786 0 0 1-1.95.794c-.76 0-1.446-.303-1.948-.793a2.74 2.74 0 0 1-.468-.602 2.738 2.738 0 0 1-.463.602 2.787 2.787 0 0 1-1.95.794h-.16a2.787 2.787 0 0 1-1.95-.793 2.738 2.738 0 0 1-.464-.602zm-2.004 2.59v.002c.795.002 1.5 0 2.373.953.687-.072 1.406-.108 2.125-.107.72 0 1.438.035 2.125.107.873-.953 1.578-.95 2.372-.953.376 0 1.876 0 2.92 2.934l1.123 4.028c.832 2.995-.266 3.068-1.636 3.07-2.03-.075-3.156-1.55-3.156-3.025-1.124.184-2.436.276-3.748.277-1.312 0-2.624-.093-3.748-.277 0 1.475-1.125 2.95-3.156 3.026-1.37-.004-2.468-.077-1.636-3.072l1.122-4.027c1.045-2.934 2.545-2.934 2.92-2.934zM12 12.714c-.002.002-2.14 1.964-2.523 2.662l1.4-.056v1.22c0 .056.56.033 1.123.007.562.026 1.124.05 1.124-.008v-1.22l1.4.055C14.138 14.677 12 12.713 12 12.713z",
		},
		{
			name: "Armor Games",
			url: "https://armorgames.com/",
			about: "Classic browser games since 2004",
			color: "#e8622c",
			letter: "A",
		},
	];
	function renderGamesPage() {
		$("games-list").replaceChildren(...gameCards((site) => navigate(site.url).catch(() => {})));
		$("games-empty").hidden = GAME_SITES.length > 0;
	}
	function gameMark(site, className) {
		const mark = el("span", className);
		if (site.logo) {
			mark.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${site.logo}" /></svg>`;
		} else {
			mark.textContent = site.letter;
		}
		return mark;
	}
	function gameCards(onPick) {
		return GAME_SITES.map((site) => {
			const card = el("button", "game-site");
			card.type = "button";
			card.style.setProperty("--brand", site.color);
			const banner = el("span", "game-banner");
			banner.append(gameMark(site, "game-banner-mark"), el("span", "game-banner-name", site.name));
			const info = el("span", "game-info");
			const text = el("span", "game-text");
			text.append(el("span", "game-name", site.name), el("span", "game-about", site.about));
			info.append(gameMark(site, "game-icon"), text);
			card.append(banner, info);
			card.addEventListener("click", (e) => onPick(site, e));
			return card;
		});
	}


	// The bottom bar. The highlighted button follows what's on screen.
	const dockButtons = [...document.querySelectorAll("[data-dock]")];
	function updateDock() {
		let current = activeTab?.page ?? null;
		if (!current && activeTab?.url) {
			if (isMovies(activeTab.url)) current = "movies";
			else if (isMusic(activeTab.url)) current = "music";
			else if (GAME_SITES.some((site) => hostOf(activeTab.url).endsWith(hostOf(site.url).replace(/^www\./, "")))) {
				current = "games";
			}
		}
		for (const button of dockButtons) {
			const on = button.dataset.dock === current || (button.dataset.dock === "apps" && $("apps-panel").open);
			button.classList.toggle("active", on);
			if (on) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		}
	}
	// Bottom bar buttons and the home screen's app buttons share these.
	function launch(target) {
		if (PAGES.includes(target)) openPage(target);
		else if (target === "movies") navigate(MOVIES_URL).catch(() => {});
		else if (target === "music") navigate(MUSIC_URL).catch(() => {});
		else if (target === "history") openHistory();
		else if (target === "apps" || target === "edit") openApps(target === "edit");
		updateDock();
	}
	function openApps(editing = false) {
		const panel = $("apps-panel");
		panel.classList.toggle("editing", editing);
		$("apps-edit").textContent = editing ? "Done" : "Edit";
		$("apps-edit").setAttribute("aria-pressed", String(editing));
		panel.showModal();
	}

	for (const button of dockButtons) button.addEventListener("click", () => launch(button.dataset.dock));
	for (const button of document.querySelectorAll("[data-app]")) {
		button.addEventListener("click", () => launch(button.dataset.app));
	}
	$("apps-close").addEventListener("click", () => $("apps-panel").close());
	// Selecting the whole address on focus, so typing replaces arc4dia://home or the URL.
	els.bar.addEventListener("focus", () => els.bar.select());

	// Home screen shortcuts: click opens in this tab; Ctrl/Cmd- or middle-click in a new one.
	function renderShortcuts() {
		els.shortcuts.replaceChildren(...shortcutItems(true));
		// The home screen shows the sites; Games, Movies and Music have their own row there.
		$("home-shortcuts").replaceChildren(...shortcutItems(false, (s) => !INTERNAL.test(s.url)));
	}
	// The Apps panel can edit (Add, and remove in Edit mode); the new-tab page just opens.
	function shortcutItems(editable, keep = () => true) {
		const items = Shortcuts.list.map((shortcut, index) => {
			if (!keep(shortcut)) return null;
			const item = el("div", "shortcut-item");
			const open = el("button", "shortcut");
			open.type = "button";
			open.title = `${shortcut.name}\n${shortcut.url}`;
			open.setAttribute("aria-label", shortcut.name);
			const tile = el("span", "shortcut-icon");
			tile.append(Shortcuts.iconFor(shortcut));
			open.append(tile, el("span", "shortcut-label", shortcut.name));
			// arc4dia:// tiles (like AI) open a panel, not a page, so never in a new tab.
			const internal = INTERNAL.test(shortcut.url);
			open.addEventListener("click", (e) => {
				const tab = !internal && (e.ctrlKey || e.metaKey) ? createTab({ activate: false }) : activeTab;
				navigate(shortcut.url, tab).catch(() => {});
			});
			open.addEventListener("auxclick", (e) => {
				if (e.button === 1 && !internal) $("apps-panel").close();
				if (e.button === 1 && !internal) navigate(shortcut.url, createTab({ activate: false })).catch(() => {});
			});
			const remove = el("button", "shortcut-remove");
			remove.type = "button";
			remove.title = `Remove ${shortcut.name}`;
			remove.setAttribute("aria-label", `Remove ${shortcut.name}`);
			remove.innerHTML =
				'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>';
			remove.addEventListener("click", () => {
				Shortcuts.remove(index);
				renderShortcuts();
			});
			item.append(open);
			if (editable && !internal) item.append(remove); // built-in apps can't be removed
			return item;
		}).filter(Boolean);
		if (editable && !Shortcuts.full) {
			const add = el("button", "shortcut shortcut-add");
			add.type = "button";
			const tile = el("span", "shortcut-icon");
			tile.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
			add.append(tile, el("span", "shortcut-label", "Add"));
			add.addEventListener("click", () => {
				$("apps-panel").close();
				openShortcutForm();
			});
			const item = el("div", "shortcut-item");
			item.append(add);
			items.push(item);
		}
		return items;
	}
	$("apps-panel").addEventListener("close", () => updateDock());
	$("apps-edit").addEventListener("click", () => {
		const editing = $("apps-panel").classList.toggle("editing");
		$("apps-edit").textContent = editing ? "Done" : "Edit";
		$("apps-edit").setAttribute("aria-pressed", String(editing));
	});

	function openShortcutForm(name = "", url = "") {
		if (Shortcuts.full) {
			setStatus("You've hit the shortcut limit. Remove one first.", true);
			return;
		}
		els.shortcutName.value = name;
		els.shortcutUrl.value = url;
		els.shortcutError.textContent = "";
		els.shortcutPanel.showModal();
		(name ? els.shortcutUrl : els.shortcutName).focus();
	}

	els.shortcutForm.addEventListener("submit", (e) => {
		const url = normalizeUrl(els.shortcutUrl.value);
		if (!url) {
			e.preventDefault();
			els.shortcutError.textContent = "Enter a web address like example.com.";
			return;
		}
		Shortcuts.add(els.shortcutName.value.trim() || hostOf(url), url);
		renderShortcuts();
	});
	for (const id of ["shortcut-close", "shortcut-cancel"]) {
		$(id).addEventListener("click", () => els.shortcutPanel.close());
	}
	$("reset-shortcuts").addEventListener("click", () => {
		Shortcuts.reset();
		renderShortcuts();
		setStatus("Home shortcuts reset.");
	});
	renderShortcuts();

	// The ☰ menu.
	const menuItems = [...els.menu.querySelectorAll("[role=menuitem]")];
	function setMenu(open) {
		els.menu.hidden = !open;
		els.menuButton.setAttribute("aria-expanded", String(open));
		if (!open) return;
		const canUsePage = !!(activeTab.url && activeTab.frame);
		for (const item of menuItems) {
			if (item.dataset.action === "bookmark") item.disabled = !canUsePage;
		}
		menuItems.find((item) => !item.disabled)?.focus();
	}
	els.menuButton.addEventListener("click", () => setMenu(els.menu.hidden));
	document.addEventListener("click", (e) => {
		if (!els.menu.hidden && !e.target.closest(".menu-wrap")) setMenu(false);
	});
	els.menu.addEventListener("keydown", (e) => {
		const enabled = menuItems.filter((item) => !item.disabled);
		const at = enabled.indexOf(document.activeElement);
		if (e.key === "Escape") {
			setMenu(false);
			els.menuButton.focus();
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const step = e.key === "ArrowDown" ? 1 : -1;
			enabled[(at + step + enabled.length) % enabled.length]?.focus();
		}
	});
	els.menu.addEventListener("click", (e) => {
		const item = e.target.closest("[role=menuitem]");
		if (!item || item.disabled) return;
		setMenu(false);
		const url = activeTab.frame && currentRealUrl(activeTab);
		switch (item.dataset.action) {
			case "apps":
				openApps(true);
				break;
			case "bookmark":
				if (url) openShortcutForm(activeTab.title || hostOf(url), url);
				break;
			case "credits":
				$("credits-panel").showModal();
				break;
			case "tour":
				Tour.open();
				break;
		}
	});

	els.historySearch.addEventListener("input", renderHistory);
	$("history-close").addEventListener("click", () => els.historyPanel.close());
	$("history-clear").addEventListener("click", () => {
		if (!browsingHistory.entries.length || !confirm("Clear all browsing history?")) return;
		browsingHistory.clear();
		renderHistory();
	});
	// Clicking the backdrop (outside a panel) closes it.
	$("credits-close").addEventListener("click", () => $("credits-panel").close());
	for (const panel of [els.historyPanel, els.shortcutPanel, $("credits-panel")]) {
		panel.addEventListener("click", (e) => {
			if (e.target === panel) panel.close();
		});
	}

	els.engine.addEventListener("change", () => settings.set("engine", els.engine.value));
	els.saveHistory.addEventListener("change", () => {
		settings.set("saveHistory", els.saveHistory.checked ? "1" : "0");
	});

	// Rebuilds the transport, on `url` or on a freshly picked server.
	async function reconnect(url) {
		if (!proxy) return;
		try {
			url ??= await pickWisp();
			proxy.failover.use(url, await connectWisp(url));
			showWisp(url);
			setStatus(`Using ${els.transport.value} via ${WispPool.label(url)}.`);
		} catch (err) {
			setStatus("Couldn't connect: " + err.message, true);
		}
	}
	els.transport.addEventListener("change", () => {
		settings.set("transport", els.transport.value);
		reconnect(proxy?.failover.url);
	});
	els.wisp.addEventListener("change", () => {
		const value = els.wisp.value.trim();
		if (value && !/^(wss?:\/\/)?[^\s/]+(\/\S*)?$/i.test(value)) {
			setStatus("Wisp server must be a host name or a ws:// / wss:// URL.", true);
			return;
		}
		settings.set("wisp", value);
		setStatus("Finding a Wisp server…");
		reconnect();
	});

	// Themes: the colors live in style.css (:root[data-theme=...]). AMOLED black is the default.
	const THEME_COLORS = {
		dark: "#000000",
		midnight: "#070a14",
		ocean: "#05100f",
		lavender: "#0b0912",
		sunset: "#100907",
		rose: "#10080b",
		mono: "#0a0a0a",
	};
	// The constellation behind the home screen, drawn in the theme's star color.
	let stopStars = null;
	function startStars() {
		stopStars?.();
		const color = getComputedStyle(document.documentElement).getPropertyValue("--star").trim() || "200 200 200";
		stopStars = Constellation.start($("stars"), color);
	}
	function applyTheme(name) {
		if (!THEME_COLORS[name]) name = "dark"; // also the old Forest theme
		els.theme.value = name;
		document.documentElement.dataset.theme = name;
		document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[name];
		startStars();
	}
	els.theme.addEventListener("change", () => {
		settings.set("theme", els.theme.value);
		applyTheme(els.theme.value);
	});
	// The home screen's wallpaper: a photo (public/wallpapers/, Night room by default) or the animated stars.
	const WALLPAPERS = ["stars", "bliss-cat", "night-room", "skylight"];
	function applyWallpaper(name) {
		if (!WALLPAPERS.includes(name)) name = "stars";
		$("wallpaper").value = name;
		const photo = name !== "stars";
		els.home.classList.toggle("photo", photo);
		els.home.style.backgroundImage = photo ? `url("wallpapers/${name}.jpg")` : "";
		$("stars").hidden = photo;
	}
	$("wallpaper").addEventListener("change", () => {
		settings.set("wallpaper", $("wallpaper").value);
		applyWallpaper($("wallpaper").value);
	});
	applyWallpaper(settings.get("wallpaper", "night-room"));

	// Themes from before the redesign start over on AMOLED black.
	if (settings.get("themeV", "") !== "2") {
		settings.set("theme", "dark");
		settings.set("themeV", "2");
	}
	applyTheme(settings.get("theme", "dark"));

	// Settings saved by the old OS mode (window places, mode, wallpaper) aren't used any more.
	for (const key of ["mode", "window", "win:movies", "win:music"]) settings.remove(key);

	createTab();
	Tour.openIfNew();
}
/* filler: c__o__d__e */
main();
