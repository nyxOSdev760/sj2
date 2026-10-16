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
	settingsPanel: $("settings-panel"),
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
	wallpaper: $("wallpaper"),
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
	const reg = await navigator.serviceWorker.register(path, {
		type: "classic",
		updateViaCache: "none",
	});
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
	const all = WispPool.expandAll(self.SJ2_CONFIG?.wispServers ?? ["self"]);
	let urls = all.filter((url) => !exclude.has(url));
	if (!urls.length) {
		exclude.clear(); // every server has failed once; give them all another chance
		urls = all;
	}
	return WispPool.fastest(urls);
}

// Backup routes for sites that fail on the main connection: epoxy (a different TLS
// engine) on the current server, then on the next healthiest servers. Epoxy clients
// each keep their own connection, so several servers can be used at once.
let healthyServers = [];
const epoxyClients = new Map();
async function alternativeRoutes(failover) {
	const urls = [failover.url, ...healthyServers.filter((u) => u !== failover.url && !failover.dead.has(u))];
	const routes = [];
	for (const url of urls.slice(0, 3)) {
		if (url === failover.url && els.transport.value === "epoxy") continue; // that's the main route
		if (!epoxyClients.has(url)) epoxyClients.set(url, AdGuardDNS.wrap(await createTransport("epoxy", url)));
		routes.push(epoxyClients.get(url));
	}
	return routes;
}

function showWisp(url) {
	els.wisp.placeholder = `Automatic · using ${WispPool.label(url)}`;
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
const HOME_URL = "skyline://home";
const INTERNAL = /^skyline:\/\/(\w+)\/?$/i;

const BAR_ICONS = {
	home: "M3 11l9-7 9 7M5 10v10h14V10",
	lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
	globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z",
};

function setBarIcon(url) {
	const name = !url ? "home" : url.startsWith("https:") ? "lock" : "globe";
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
	els.engine.value = settings.get("engine", els.engine.options[0].value);
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

	function updateTabLabel(tab) {
		const text = tab.url ? tab.title || hostOf(tab.url) : "New tab";
		tab.label.textContent = text;
		tab.el.title = tab.url ? `${text}\n${tab.url}` : text;
	}

	function createTab({ activate = true } = {}) {
		const tab = { url: "", title: "", recordedUrl: null, iframe: null, frame: null };
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
		els.home.hidden = !!tab.url;
		els.bar.value = tab.url || HOME_URL;
		setBarIcon(tab.url);
		updateDock();
		tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
		if (!tab.url) {
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
			if (page === "history") openHistory();
			else if (page === "ai") openPanel("ai");
			else if (page === "chat") openPanel("chat");
			else if (page === "games") openGames();
			else if (page === "settings") els.settingsPanel.showModal();
			else goHome(tab);
			return;
		}
		const url = toUrl(input);
		if (!url) return;
		if (!proxy) setStatus("Still starting, one moment…");
		await ready;
		if (!tabs.includes(tab)) return; // closed while the proxy was starting
		ensureFrame(tab);
		tab.url = url;
		tab.title = "";
		tab.frame.go(url);
		updateTabLabel(tab);
		if (tab === activeTab) selectTab(tab);
	}

	// Reads a tab's real URL and title, including SPA navigations that never fire
	// "load", and records new URLs in history.
	function syncTab(tab) {
		if (!tab.frame || !tab.url) return;
		const url = currentRealUrl(tab);
		const title = currentTitle(tab);
		const changed = (url && url !== tab.url) || title !== tab.title;
		if (url) {
			tab.url = url;
			if (url !== tab.recordedUrl) {
				tab.recordedUrl = url;
				browsingHistory.add(url, title);
			} else {
				browsingHistory.setTitle(url, title);
			}
		}
		tab.title = title;
		if (changed) updateTabLabel(tab);
		if (changed && tab === activeTab) updateDock();
		if (tab === activeTab && document.activeElement !== els.bar && els.bar.value !== tab.url) {
			els.bar.value = tab.url;
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
			open.append(
				el("span", "history-title", entry.title || hostOf(entry.url)),
				el("span", "history-url", entry.url)
			);
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
	$("back").addEventListener("click", () => activeTab.url && activeTab.frame?.back());
	$("forward").addEventListener("click", () => activeTab.url && activeTab.frame?.forward());
	$("reload").addEventListener("click", () => activeTab.url && activeTab.frame?.reload());
	$("home").addEventListener("click", () => goHome(activeTab));
	$("show-settings").addEventListener("click", () => els.settingsPanel.showModal());
	// AI and Chat drawers, one at a time, opened from the bottom bar (and skyline://ai, /chat).
	const panels = { ai: SkylineAI, chat: SkylineChat };
	function openPanel(name) {
		for (const [key, panel] of Object.entries(panels)) if (key !== name) panel.close();
		panels[name].open();
		updateDock();
	}
	SkylineAI.init();
	SkylineChat.init({
		unreadChanged(count) {
			const badge = document.querySelector('[data-dock="chat"] .dock-badge');
			badge.hidden = !count;
			badge.textContent = count > 99 ? "99+" : String(count);
		},
	});

	// Games: free game sites, opened through the proxy like any other site.
	// Each card shows the site's own banner and logo (public/games/).
	const GAME_SITES = [
		{ name: "Poki", url: "https://poki.com/", art: "poki", about: "Thousands of free games" },
		{ name: "CrazyGames", url: "https://www.crazygames.com/", art: "crazy", about: "New games every day" },
		{ name: "Coolmath Games", url: "https://www.coolmathgames.com/", art: "cool", about: "Puzzle and logic classics" },
		{ name: "Duck Math", url: "https://duckmath.org/", art: "duck", about: "Popular browser games" },
	];
	function openGames() {
		const list = $("games-list");
		list.replaceChildren(
			...GAME_SITES.map((site) => {
				const card = el("button", "game-site");
				card.type = "button";
				const banner = el("img", "game-banner");
				banner.src = `games/${site.art}.jpg`;
				banner.alt = "";
				banner.loading = "lazy";
				const info = el("span", "game-info");
				const icon = el("img", "game-icon");
				icon.src = `games/${site.art}-icon.png`;
				icon.alt = "";
				const text = el("span", "game-text");
				text.append(el("span", "game-name", site.name), el("span", "game-about", site.about));
				info.append(icon, text);
				card.append(banner, info);
				card.addEventListener("click", (e) => {
					$("games-panel").close();
					SkylineAI.close();
					SkylineChat.close();
					const tab = e.ctrlKey || e.metaKey ? createTab({ activate: false }) : activeTab;
					navigate(site.url, tab).catch(() => {});
				});
				return card;
			})
		);
		$("games-panel").showModal();
	}
	$("games-close").addEventListener("click", () => $("games-panel").close());

	// The bottom bar. The highlighted button follows what's on screen.
	const MUSIC_URL = "https://soundcloud.com/";
	const dockButtons = [...document.querySelectorAll("[data-dock]")];
	function updateDock() {
		let current = null;
		if (SkylineChat.isOpen) current = "chat";
		else if (SkylineAI.isOpen) current = "ai";
		else if (!activeTab?.url) current = "home";
		else if (hostOf(activeTab.url).endsWith("soundcloud.com")) current = "music";
		else if (GAME_SITES.some((site) => hostOf(activeTab.url).endsWith(hostOf(site.url).replace(/^www\./, "")))) {
			current = "games";
		}
		for (const button of dockButtons) {
			button.classList.toggle("active", button.dataset.dock === current);
			if (button.dataset.dock === current) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		}
	}
	for (const button of dockButtons) {
		button.addEventListener("click", () => {
			const target = button.dataset.dock;
			if (target === "ai" || target === "chat") {
				if (panels[target].isOpen) panels[target].close();
				else openPanel(target);
			} else if (target === "history") {
				openHistory();
			} else if (target === "games") {
				openGames();
			} else {
				SkylineAI.close();
				SkylineChat.close();
				if (target === "home") goHome(activeTab);
				else navigate(MUSIC_URL).catch(() => {});
			}
			updateDock();
		});
	}
	// Panels also close themselves (Escape, their × button), so watch them.
	const watchPanels = new MutationObserver(updateDock);
	for (const id of ["ai-panel", "chat-panel"]) watchPanels.observe($(id), { attributes: true, attributeFilter: ["hidden"] });
	$("settings-close").addEventListener("click", () => els.settingsPanel.close());
	// Selecting the whole address on focus, so typing replaces skyline://home or the URL.
	els.bar.addEventListener("focus", () => els.bar.select());

	// Home screen shortcuts: click opens in this tab; Ctrl/Cmd- or middle-click in a new one.
	function renderShortcuts() {
		const items = Shortcuts.list.map((shortcut, index) => {
			const item = el("div", "shortcut-item");
			const open = el("button", "shortcut");
			open.type = "button";
			open.title = `${shortcut.name}\n${shortcut.url}`;
			const tile = el("span", "shortcut-icon");
			tile.append(Shortcuts.iconFor(shortcut));
			open.append(tile, el("span", "shortcut-label", shortcut.name));
			// skyline:// tiles (like AI) open a panel, not a page, so never in a new tab.
			const internal = INTERNAL.test(shortcut.url);
			open.addEventListener("click", (e) => {
				const tab = !internal && (e.ctrlKey || e.metaKey) ? createTab({ activate: false }) : activeTab;
				navigate(shortcut.url, tab).catch(() => {});
			});
			open.addEventListener("auxclick", (e) => {
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
			item.append(open, remove);
			return item;
		});
		if (!Shortcuts.full) {
			const add = el("button", "shortcut shortcut-add");
			add.type = "button";
			const tile = el("span", "shortcut-icon");
			tile.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
			add.append(tile, el("span", "shortcut-label", "Add"));
			add.addEventListener("click", () => openShortcutForm());
			const item = el("div", "shortcut-item");
			item.append(add);
			items.push(item);
		}
		els.shortcuts.replaceChildren(...items);
	}

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
			case "ai":
				openPanel("ai");
				break;
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
	for (const panel of [els.settingsPanel, els.historyPanel, els.shortcutPanel, $("credits-panel"), $("games-panel")]) {
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

	function applyTheme(name) {
		const dark = name === "dark";
		els.theme.value = dark ? "dark" : "lavender";
		if (dark) document.documentElement.dataset.theme = "dark";
		else delete document.documentElement.dataset.theme;
		document.querySelector('meta[name="theme-color"]').content = dark ? "#000000" : "#e9e7f6";
	}
	els.theme.addEventListener("change", () => {
		settings.set("theme", els.theme.value);
		applyTheme(els.theme.value);
	});
	applyTheme(settings.get("theme", "lavender"));

	// Home screen wallpaper: a photo, or an animation drawn on the canvas.
	const DEFAULT_WALLPAPER = "gtr-sunset";
	const animations = { snow: Snowfall, night: Constellation };
	let stopAnimation = null;
	function applyWallpaper(name) {
		if (![...els.wallpaper.options].some((o) => o.value === name)) name = DEFAULT_WALLPAPER;
		els.wallpaper.value = name;
		els.home.dataset.wallpaper = name;
		els.home.classList.toggle("photo", !animations[name]);
		stopAnimation?.();
		stopAnimation = animations[name]?.start($("stars")) ?? null;
	}
	els.wallpaper.addEventListener("change", () => {
		settings.set("wallpaper", els.wallpaper.value);
		applyWallpaper(els.wallpaper.value);
	});
	applyWallpaper(settings.get("wallpaper", DEFAULT_WALLPAPER));

	createTab();
	Tour.openIfNew();
}
/* filler: c__o__d__e */
main();
