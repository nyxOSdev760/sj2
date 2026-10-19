"use strict";
/* filler: c__o__d__e */
// Directory the app is served from: "/" normally, "/<repo>/" on GitHub Pages project
// sites. Everything is resolved against it so the app works from any subpath.
const BASE = new URL("./", location.href);
const path = (p) => new URL(p, BASE).pathname;

const PATHS = {
	sw: path("sw.js"),
	prefix: path("~/sj/"),
	scramjet: path("scramjet/scramjet.js"),
	wasm: path("scramjet/scramjet.wasm"),
	controllerApi: path("controller/controller.api.js"),
	controllerInject: path("controller/controller.inject.js"),
	libcurl: path("libcurl/index.js"),
	epoxy: path("epoxy/index.js"),
};

const $ = (id) => document.getElementById(id);
const els = {
	tabs: $("tabs"),
	toolbar: $("toolbar"),
	home: $("home-screen"),
	desktop: $("desktop"),
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
async function createTransport(name, wisp) {
	if (name === "epoxy") {
		if (!transportScripts.has(name)) await loadScript(PATHS.epoxy);
		transportScripts.add(name);
		return new EpoxyTransport.default({ wisp });
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
	for (const url of urls.slice(0, 4)) {
		if (url === failover.url && els.transport.value === "epoxy") continue; // that's the main route
		if (!epoxyClients.has(url)) epoxyClients.set(url, AdGuardDNS.wrap(await createTransport("epoxy", url)));
		routes.push(epoxyClients.get(url));
	}
	return routes;
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
	// In the background, find every server that answers, for the backup routes.
	WispPool.healthy(WispPool.expandAll(self.SJ2_CONFIG?.wispServers ?? ["self"])).then((list) => {
		healthyServers = list;
	});

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
const HOME_URL = "skeld://home";
const PAGES = ["settings", "games"];
const PAGE_TITLES = { settings: "Settings", games: "Games" };
const INTERNAL = /^(?:skeld|skyline):\/\/(\w+)\/?$/i; // skyline:// from before the rename

const BAR_ICONS = {
	home: "M3 11l9-7 9 7M5 10v10h14V10",
	lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
	globe:
		"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
};

// Movies is movy.sx, but the address bar, tabs and history call it skeld://movies.
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
function shownUrl(url) {
	return isMovies(url) ? "skeld://movies" : url;
}

function setBarIcon(url) {
	const name = !url || isMovies(url) ? "home" : url.startsWith("https:") ? "lock" : "globe";
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
				? "New tab"
				: isMovies(tab.url)
					? "Movies"
					: tab.title || hostOf(tab.url);
		tab.label.textContent = text;
		tab.el.title = tab.url ? `${text}\n${shownUrl(tab.url)}` : text;
	}

	function createTab({ activate = true } = {}) {
		// `page` is a built-in page (skeld://settings, skeld://games) shown instead of a site.
		const tab = { url: "", page: null, title: "", recordedUrl: null, iframe: null, frame: null };
		tab.el = el("div", "tab");
		tab.el.setAttribute("role", "tab");
		tab.el.tabIndex = 0;
		tab.label = el("span", "tab-title");
		const close = el("button", "tab-close", "×");
		close.title = "Close tab";
		close.setAttribute("aria-label", "Close tab");
		tab.el.append(tab.label, close);

		tab.el.addEventListener("click", (e) => {
			if (e.target === close) closeTab(tab);
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
		}
		els.home.hidden = !!tab.url || !!tab.page;
		for (const name of PAGES) $("page-" + name).hidden = tab.page !== name;
		els.bar.value = tab.page ? "skeld://" + tab.page : tab.url ? shownUrl(tab.url) : HOME_URL;
		setBarIcon(tab.url);
		updateDock();
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
			tab.iframe.remove();
			const frames = proxy.controller.frames;
			if (frames.includes(tab.frame)) frames.splice(frames.indexOf(tab.frame), 1);
		}
		if (!tabs.length) createTab();
		else if (tab === activeTab) selectTab(tabs[Math.min(index, tabs.length - 1)]);
	}

	function goHome(tab) {
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
		tab.frame = proxy.controller.createFrame(tab.iframe);
		tab.iframe.addEventListener("load", () => syncTab(tab));
	}

	async function navigate(input, tab = activeTab) {
		const page = input.trim().match(INTERNAL)?.[1].toLowerCase();
		if (page) {
			const os = document.body.dataset.mode === "os";
			if (page === "movies") return os ? launch("movies") : navigate(MOVIES_URL, tab);
			if (page === "history") openHistory();
			else if (PAGES.includes(page)) openPage(page, tab);
			else goHome(tab);
			return;
		}
		const url = toUrl(input);
		if (!url) return;
		// Remember searches, to re-run them elsewhere if the engine turns the proxy away.
		tab.searchQuery = url === els.engine.value.replace("%s", encodeURIComponent(input.trim())) ? input.trim() : null;
		setView("browser");
		if (!proxy) setStatus("Still starting, one moment…");
		await ready;
		if (!tabs.includes(tab)) return; // closed while the proxy was starting
		ensureFrame(tab);
		tab.page = null;
		tab.url = url;
		tab.title = "";
		tab.frame.go(url);
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
		const title = currentTitle(tab);
		const changed = (url && url !== tab.url) || title !== tab.title;
		if (url) {
			tab.url = url;
			if (url !== tab.recordedUrl) {
				tab.recordedUrl = url;
				browsingHistory.add(shownUrl(url), isMovies(url) ? "Movies" : title);
			} else {
				browsingHistory.setTitle(url, title);
			}
		}
		tab.title = title;
		if (tab.searchQuery && url && searchBlocked(tab, url)) {
			const query = tab.searchQuery;
			tab.searchQuery = null;
			setStatus("DuckDuckGo turned the proxy away, so this search ran on Bing.");
			navigate(FALLBACK_SEARCH.replace("%s", encodeURIComponent(query)), tab).catch(() => {});
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
	// Back/forward only within the page's own history: with nothing to go back to, the
	// browser would go back in Skeld itself and lose every tab.
	function canStep(iframe, dir) {
		try {
			const nav = iframe?.contentWindow?.navigation;
			if (nav) return dir < 0 ? nav.canGoBack : nav.canGoForward;
		} catch {}
		return false;
	}
	$("back").addEventListener("click", () => activeTab.url && canStep(activeTab.iframe, -1) && activeTab.frame?.back());
	$("forward").addEventListener("click", () => activeTab.url && canStep(activeTab.iframe, 1) && activeTab.frame?.forward());
	$("reload").addEventListener("click", () => activeTab.url && activeTab.frame?.reload());
	$("home").addEventListener("click", () => goHome(activeTab));
	$("show-settings").addEventListener("click", () => openPage("settings"));

	// Built-in pages (skeld://settings, skeld://games): shown in a tab like any site. One
	// opens in the tab it's asked for if that's a new tab, in the tab already showing it,
	// or in a new tab.
	function openPage(name, tab = activeTab) {
		const target = tab && !tab.url && !tab.page ? tab : tabs.find((t) => t.page === name) || createTab();
		if (target.iframe) target.iframe.src = "about:blank";
		target.url = "";
		target.title = "";
		target.recordedUrl = null;
		target.page = name;
		if (name === "games") renderGamesPage();
		updateTabLabel(target);
		selectTab(target);
		setView("browser");
	}
	// Two views: the desktop and the browser. In OS mode the desktop stays up and the
	// browser is a window on it; in browser mode the browser is the whole page.
	const osWindow = $("os-window");
	function setView(view) {
		document.body.dataset.view = view;
		const os = document.body.dataset.mode === "os";
		els.desktop.hidden = !os && view !== "desktop";
		els.browser.hidden = !os && view !== "browser";
		osWindow.hidden = os && view !== "browser";
		if (os && view === "browser") focusWindow(osWindow);
		if (view === "browser" && !activeTab?.url) els.search.focus();
		updateDock();
	}

	// OS mode windows: the browser, plus a window per app (Movies, Games, each game).
	// Drag by the title bar, resize from the corner, double-click or the middle button to
	// maximize, click to bring to the front. Phones get every window full screen.
	let zTop = 30;
	function focusWindow(win) {
		win.style.zIndex = ++zTop;
		for (const w of document.querySelectorAll(".os-window")) w.classList.toggle("focused", w === win);
		updateDock();
	}
	function makeWindow(win, key, fallback) {
		const place = (rect) => {
			// Between the top bar (26px) and the taskbar (44px), so the corner stays reachable.
			const top = 26;
			const bottom = innerHeight - 44;
			const w = Math.min(Math.max(rect.w, 340), innerWidth);
			const h = Math.min(Math.max(rect.h, 220), bottom - top);
			const x = Math.min(Math.max(rect.x, 0), innerWidth - w);
			const y = Math.min(Math.max(rect.y, top), bottom - h);
			Object.assign(win.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
			return { x, y, w, h };
		};
		let rect;
		try {
			rect = JSON.parse(settings.get(key, "null"));
		} catch {
			rect = null;
		}
		rect = place(rect ?? fallback());
		const drag = (e, resize) => {
			if (e.button !== 0 || win.classList.contains("maximized") || innerWidth < 700) return;
			e.preventDefault();
			const start = { px: e.clientX, py: e.clientY, ...rect };
			document.body.classList.add("moving-window"); // pages can't swallow the pointer meanwhile
			const move = (ev) => {
				const dx = ev.clientX - start.px;
				const dy = ev.clientY - start.py;
				rect = place(resize ? { ...start, w: start.w + dx, h: start.h + dy } : { ...start, x: start.x + dx, y: start.y + dy });
			};
			const up = () => {
				document.body.classList.remove("moving-window");
				removeEventListener("pointermove", move);
				removeEventListener("pointerup", up);
				settings.set(key, JSON.stringify(rect));
			};
			addEventListener("pointermove", move);
			addEventListener("pointerup", up);
		};
		const bar = win.querySelector(".os-window-bar");
		win.addEventListener("pointerdown", () => focusWindow(win), true);
		bar.addEventListener("pointerdown", (e) => !e.target.closest("button") && drag(e, false));
		win.querySelector(".os-window-resize").addEventListener("pointerdown", (e) => drag(e, true));
		bar.addEventListener("dblclick", (e) => !e.target.closest("button") && win.classList.toggle("maximized"));
		addEventListener("resize", () => (rect = place(rect)));
	}
	const cascade = (n) => () => ({
		x: innerWidth * 0.1 + n * 28,
		y: 52 + n * 28,
		w: Math.min(1100, innerWidth * 0.78),
		h: innerHeight - 150 - n * 28,
	});
	makeWindow(osWindow, "window", cascade(0));
	$("os-window-bar").addEventListener("click", (e) => {
		const action = e.target.closest("[data-win]")?.dataset.win;
		if (action === "max") osWindow.classList.toggle("maximized");
		else if (action === "min") setView("desktop");
		else if (action === "close") {
			for (const tab of [...tabs]) closeTab(tab); // leaves one new tab
			setView("desktop");
		}
	});

	// App windows show one site through the proxy, without the browser's tabs and bar.
	const appWindows = new Map(); // id -> { win, iframe, frame }
	const WIN_BUTTONS = [
		["back", "Back", "M15 6l-6 6 6 6"],
		["reload", "Reload", "M20 11a8 8 0 1 0-2.3 5.6M20 4v7h-7"],
		["full", "Full screen", "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"],
		["min", "Minimize", "M6 12h12"],
		["max", "Maximize", "M6 6h12v12H6z"],
		["close", "Close", "M7 7l10 10M17 7L7 17"],
	];
	function windowShell(id, title) {
		const win = el("div", "os-window app-window");
		win.dataset.app = id;
		const bar = el("div", "os-window-bar");
		bar.append(el("span", "os-window-title", title));
		for (const [action, label, d] of WIN_BUTTONS) {
			const button = el("button");
			button.type = "button";
			button.dataset.win = action;
			button.title = label;
			button.setAttribute("aria-label", label);
			button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" /></svg>`;
			bar.append(button);
		}
		const body = el("div", "app-window-body");
		win.append(bar, body, el("div", "os-window-resize"));
		document.body.append(win);
		makeWindow(win, "win:" + id, cascade(1 + (appWindows.size % 5)));
		return { win, bar, body };
	}
	function closeAppWindow(id) {
		const entry = appWindows.get(id);
		if (!entry) return;
		const frames = proxy?.controller.frames;
		if (frames?.includes(entry.frame)) frames.splice(frames.indexOf(entry.frame), 1);
		entry.win.remove();
		appWindows.delete(id);
		updateDock();
	}
	function showAppWindow(entry) {
		entry.win.hidden = false;
		focusWindow(entry.win);
	}
	// Opens (or brings back) a window showing `url`.
	async function openAppWindow(id, title, url) {
		const open = appWindows.get(id);
		if (open) return showAppWindow(open);
		const { win, bar, body } = windowShell(id, title);
		const entry = { win, iframe: null, frame: null };
		appWindows.set(id, entry);
		focusWindow(win);
		const loading = el("div", "app-window-loading");
		const loadingText = el("p", null, `Loading ${title}…`);
		loading.append(el("span", "spinner"), loadingText);
		body.append(loading);
		bar.addEventListener("click", (e) => {
			const action = e.target.closest("[data-win]")?.dataset.win;
			if (!action) return;
			const page = entry.iframe?.contentWindow;
			if (action === "close") closeAppWindow(id);
			else if (action === "min") {
				win.hidden = true;
				updateDock();
			} else if (action === "max") win.classList.toggle("maximized");
			else if (action === "full") (entry.iframe ?? win).requestFullscreen?.().catch(() => {});
			else if (action === "back") canStep(entry.iframe, -1) && page?.history.back();
			else if (action === "reload") page?.location.reload();
		});
		await ready;
		if (!appWindows.has(id) || !proxy) return;
		entry.iframe = el("iframe");
		entry.iframe.title = title;
		entry.iframe.allow = "fullscreen; autoplay; encrypted-media; picture-in-picture";
		// The overlay stays until the proxied page itself loads (not the first about:blank).
		entry.iframe.addEventListener("load", () => {
			try {
				if (entry.iframe.contentWindow.location.href.includes("/~/sj/")) loading.remove();
			} catch {
				loading.remove();
			}
		});
		body.append(entry.iframe);
		entry.frame = proxy.controller.createFrame(entry.iframe);
		entry.frame.go(url);
		setTimeout(() => {
			if (!loading.isConnected) return;
			loadingText.textContent = `${title} is taking a while…`;
			const retry = el("button", "text-button", "Retry");
			retry.type = "button";
			retry.addEventListener("click", () => {
				loadingText.textContent = `Loading ${title}…`;
				retry.remove();
				entry.frame.go(url);
			});
			loading.append(retry);
		}, 20000);
	}
	// A taskbar button for a window: open it, bring it to the front, or minimize it.
	function toggleWindow(win, open) {
		if (!win || win.hidden) return open();
		if (win.classList.contains("focused")) {
			win.hidden = true;
			updateDock();
		} else focusWindow(win);
	}

	// Games: free game sites, opened through the proxy like any other site.
	// Each card shows the site's own banner and logo (public/games/).
	// Game sites shown on skeld://games, opened through the proxy like any other site.
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
		let current = "browser";
		if (document.body.dataset.view === "desktop") current = "desktop";
		else if (!activeTab?.url) current = "browser";
		else if (isMovies(activeTab.url)) current = "movies";
		else if (GAME_SITES.some((site) => hostOf(activeTab.url).endsWith(hostOf(site.url).replace(/^www\./, "")))) {
			current = "games";
		}
		if (activeTab?.page && document.body.dataset.view !== "desktop") current = activeTab.page;
		$("os-window-title").textContent = activeTab ? activeTab.label.textContent : "New tab";
		// In OS mode the taskbar marks every open window, and the focused one more strongly.
		const os = document.body.dataset.mode === "os";
		const openApps = os ? [...document.querySelectorAll(".app-window")] : [];
		const windowFor = {
			browser: osWindow.hidden ? [] : [osWindow],
			movies: openApps.filter((w) => w.dataset.app === "movies"),
		};
		for (const button of dockButtons) {
			const wins = windowFor[button.dataset.dock] ?? [];
			const on = os ? wins.length > 0 : button.dataset.dock === current;
			button.classList.toggle("active", on);
			const dialogOpen =
				(button.dataset.dock === "apps" && $("apps-panel").open) ||
				(PAGES.includes(button.dataset.dock) && current === button.dataset.dock && !osWindow.hidden);
			button.classList.toggle(
				"focused",
				os && (dialogOpen || wins.some((w) => !w.hidden && w.classList.contains("focused")))
			);
			if (on) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		}
	}
	// Dock buttons and desktop icons share these.
	function launch(target) {
		const os = document.body.dataset.mode === "os";
		if (PAGES.includes(target)) {
			openPage(target);
		} else if (target === "movies" && os) {
			toggleWindow(appWindows.get("movies")?.win, () => openAppWindow("movies", "Movies", MOVIES_URL));
		} else if (target === "browser" && os) {
			toggleWindow(osWindow.hidden ? null : osWindow, () => {
				setView("browser");
				focusWindow(osWindow);
			});
		} else if (target === "apps") {
			$("apps-panel").showModal();
		} else if (target === "browser-mode") setMode("browser");
		else if (target === "desktop") setView("desktop");
		else if (target === "browser") setView("browser");
		else if (target === "movies") navigate(MOVIES_URL).catch(() => {});
		updateDock();
	}

	for (const button of dockButtons) button.addEventListener("click", () => launch(button.dataset.dock));
	for (const button of document.querySelectorAll("[data-app]")) {
		button.addEventListener("click", () => launch(button.dataset.app));
	}
	$("apps-close").addEventListener("click", () => $("apps-panel").close());
	// Selecting the whole address on focus, so typing replaces skeld://home or the URL.
	els.bar.addEventListener("focus", () => els.bar.select());

	// Home screen shortcuts: click opens in this tab; Ctrl/Cmd- or middle-click in a new one.
	function renderShortcuts() {
		els.shortcuts.replaceChildren(...shortcutItems(true));
		$("home-shortcuts").replaceChildren(...shortcutItems(false));
	}
	// The Apps panel can edit (Add, and remove in Edit mode); the new-tab page just opens.
	function shortcutItems(editable) {
		const items = Shortcuts.list.map((shortcut, index) => {
			const item = el("div", "shortcut-item");
			const open = el("button", "shortcut");
			open.type = "button";
			open.title = `${shortcut.name}\n${shortcut.url}`;
			const tile = el("span", "shortcut-icon");
			tile.append(Shortcuts.iconFor(shortcut));
			open.append(tile, el("span", "shortcut-label", shortcut.name));
			// skeld:// tiles (like AI) open a panel, not a page, so never in a new tab.
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
		});
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
			case "history":
				openHistory();
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

	// Browser themes: the colors live in style.css (:root[data-theme=...]).
	const THEME_COLORS = {
		lavender: "#e9e7f6",
		dark: "#000000",
		midnight: "#0a1024",
		forest: "#0b1510",
		sunset: "#1a0f12",
		ocean: "#06171c",
		rose: "#f8eef1",
		mono: "#efefef",
	};
	function applyTheme(name) {
		if (!THEME_COLORS[name]) name = "lavender";
		els.theme.value = name;
		if (name === "lavender") delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = name;
		document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[name];
	}
	els.theme.addEventListener("change", () => {
		settings.set("theme", els.theme.value);
		applyTheme(els.theme.value);
	});
	applyTheme(settings.get("theme", "lavender"));

	// Wallpaper: a photo, or an animation drawn on the canvas. "Change wallpaper" opens a
	// picker with all of them.
	const WALLPAPERS = [
		{ id: "gtr-sunset", name: "GT-R sunset" },
		{ id: "r34-night", name: "Night drive" },
		{ id: "maybach-night", name: "Maybach night" },
		{ id: "maybach-driveway", name: "Maybach driveway" },
		{ id: "flower-field", name: "Flower field" },
		{ id: "hokage", name: "Hokage" },
		{ id: "overcast", name: "Overcast" },
		{ id: "beach", name: "Beach" },
		{ id: "blue-hour", name: "Blue hour" },
		{ id: "cabin", name: "Cabin" },
		{ id: "snow", name: "Snow", animated: true },
		{ id: "night", name: "Night sky", animated: true },
	];
	const DEFAULT_WALLPAPER = "gtr-sunset";
	const animations = { snow: Snowfall, night: Constellation };
	let stopAnimation = null;
	let currentWallpaper = null;
	function applyWallpaper(name) {
		if (!WALLPAPERS.some((w) => w.id === name)) name = DEFAULT_WALLPAPER;
		currentWallpaper = name;
		$("wallpaper-layer").dataset.wallpaper = name;
		$("wallpaper-layer").classList.toggle("photo", !animations[name]);
		stopAnimation?.();
		stopAnimation = animations[name]?.start($("stars")) ?? null;
	}
	applyWallpaper(settings.get("wallpaper", DEFAULT_WALLPAPER));

	const wallpaperPanel = $("wallpaper-panel");
	function openWallpapers() {
		const cards = WALLPAPERS.map((wallpaper) => {
			const card = el("button", "wallpaper-card");
			card.type = "button";
			card.setAttribute("role", "radio");
			card.setAttribute("aria-checked", String(wallpaper.id === currentWallpaper));
			const preview = el("span", "wallpaper-preview");
			preview.dataset.wallpaper = wallpaper.id;
			const label = el("span", "wallpaper-name", wallpaper.name);
			if (wallpaper.animated) label.append(el("span", "wallpaper-tag", "Animated"));
			card.append(preview, label);
			// Applies right away and stays open, so several can be tried in a row.
			card.addEventListener("click", () => {
				settings.set("wallpaper", wallpaper.id);
				applyWallpaper(wallpaper.id);
				for (const other of cards) other.setAttribute("aria-checked", String(other === card));
			});
			return card;
		});
		$("wallpaper-list").replaceChildren(...cards);
		wallpaperPanel.showModal();
		cards.find((c) => c.getAttribute("aria-checked") === "true")?.focus();
	}
	$("choose-wallpaper").addEventListener("click", openWallpapers);
	$("wallpaper-close").addEventListener("click", () => wallpaperPanel.close());

	// The lock screen's date and clock, and the top bar's clock.
	const dateEl = $("lock-date");
	const timeEl = $("lock-time");
	const smallTimeEl = $("topbar-time");
	function tick() {
		const now = new Date();
		dateEl.textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
		// The big clock leaves out AM/PM.
		timeEl.textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
			.formatToParts(now)
			.filter((part) => part.type !== "dayPeriod")
			.map((part) => part.value)
			.join("")
			.trim();
		smallTimeEl.textContent = now.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
			second: "2-digit",
		});
		setTimeout(tick, 1000 - now.getMilliseconds() + 5);
	}
	tick();

	createTab();
	// OS mode (desktop, dock) or browser mode (just the browser). Asked on the first visit.
	function setMode(mode, lockScreen = false) {
		settings.set("mode", mode);
		document.body.dataset.mode = mode;
		$("switch-mode").textContent = mode === "os" ? "Switch to browser mode" : "Switch to OS mode";
		if (mode !== "os") for (const id of [...appWindows.keys()]) closeAppWindow(id);
		const browsing = tabs.some((t) => t.url || t.page);
		setView(mode === "os" && !(browsing && !lockScreen) ? "desktop" : "browser");
		if (mode === "os" && lockScreen) showLock();
		else hideLock();
	}

	// OS mode starts on a lock screen: drag or swipe it up (or scroll, press Enter / an
	// arrow key, or tap the hint) to get to the desktop.
	const lock = $("lock");
	function showLock() {
		lock.style.transform = "";
		lock.hidden = false;
		document.body.classList.add("locked");
		lock.focus({ preventScroll: true });
	}
	function hideLock() {
		lock.hidden = true;
		document.body.classList.remove("locked");
	}
	let tourAfterUnlock = false;
	function unlock() {
		if (lock.hidden || lock.classList.contains("unlocking")) return;
		if (tourAfterUnlock) setTimeout(() => Tour.openIfNew(), 500);
		tourAfterUnlock = false;
		lock.classList.add("unlocking");
		lock.style.transform = "translateY(-100%)";
		document.body.classList.remove("locked");
		setTimeout(() => {
			lock.classList.remove("unlocking");
			hideLock();
		}, 450);
	}
	lock.addEventListener("pointerdown", (e) => {
		const y0 = e.clientY;
		const t0 = performance.now();
		let dy = 0;
		lock.setPointerCapture(e.pointerId);
		lock.classList.add("dragging");
		const move = (ev) => {
			dy = Math.min(0, ev.clientY - y0);
			lock.style.transform = `translateY(${dy}px)`;
		};
		const up = () => {
			lock.classList.remove("dragging");
			lock.removeEventListener("pointermove", move);
			lock.removeEventListener("pointerup", up);
			lock.removeEventListener("pointercancel", up);
			const fast = -dy / (performance.now() - t0) > 0.6; // a flick
			if (-dy > innerHeight * 0.18 || (fast && -dy > 30)) unlock();
			else lock.style.transform = "";
		};
		lock.addEventListener("pointermove", move);
		lock.addEventListener("pointerup", up);
		lock.addEventListener("pointercancel", up);
	});
	lock.addEventListener("wheel", (e) => Math.abs(e.deltaY) > 20 && unlock(), { passive: true });
	lock.addEventListener("keydown", (e) => {
		if (["Enter", " ", "ArrowUp", "PageUp"].includes(e.key)) {
			e.preventDefault();
			unlock();
		}
	});
	$("lock-hint").addEventListener("click", unlock);
	$("to-browser-mode").addEventListener("click", () => setMode("browser"));
	$("switch-mode").addEventListener("click", () => {
		setMode(document.body.dataset.mode === "os" ? "browser" : "os");
	});
	const modePanel = $("mode-panel");
	for (const option of modePanel.querySelectorAll("[data-mode]")) {
		option.addEventListener("click", () => {
			setMode(option.dataset.mode);
			modePanel.close();
		});
	}
	// The picker needs an answer (Escape doesn't close it); the tour follows it.
	modePanel.addEventListener("cancel", (e) => e.preventDefault());
	modePanel.addEventListener("close", () => Tour.openIfNew());
	const savedMode = settings.get("mode", "");
	if (savedMode) {
		setMode(savedMode === "browser" ? "browser" : "os", true); // OS mode opens on the lock screen
		if (lock.hidden) Tour.openIfNew();
		else tourAfterUnlock = true;
	} else {
		document.body.dataset.mode = "os";
		setView("desktop");
		modePanel.showModal();
	}
}
/* filler: c__o__d__e */
main();
