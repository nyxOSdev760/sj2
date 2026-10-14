"use strict";

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

// config.js sets an external Wisp server for static hosting; otherwise use our own.
function defaultWisp() {
	const local = new URL("wisp/", BASE);
	local.protocol = location.protocol === "https:" ? "wss:" : "ws:";
	return self.SJ2_CONFIG?.wisp || local.href;
}

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
	adblock: $("adblock"),
	saveHistory: $("save-history"),
	settingsPanel: $("settings-panel"),
	settingsStatus: $("settings-status"),
	historyPanel: $("history-panel"),
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
async function createTransport(name) {
	const wisp = els.wisp.value.trim() || defaultWisp();
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
async function createFilteredTransport(name) {
	return AdGuardDNS.wrap(await createTransport(name));
}

async function boot() {
	if (!("serviceWorker" in navigator)) {
		throw new Error(
			"Service workers are unavailable. Open this site over HTTPS or on localhost (and not in a private window on Firefox)."
		);
	}

	const sw = await registerServiceWorker(PATHS.sw);
	await loadScript(PATHS.scramjet);
	await loadScript(PATHS.controllerApi);
	const transport = await createFilteredTransport(els.transport.value);

	const { Controller, config } = $scramjetController;
	config.prefix = PATHS.prefix;
	config.scramjetPath = PATHS.scramjet;
	config.wasmPath = PATHS.wasm;
	config.injectPath = PATHS.controllerInject;

	const controller = new Controller({ serviceworker: sw, transport });
	await controller.wait();
	return { controller };
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
	els.wisp.placeholder = defaultWisp();
	els.wisp.value = settings.get("wisp", "");
	els.engine.value = settings.get("engine", els.engine.options[0].value);
	if (!els.engine.value) els.engine.selectedIndex = 0;
	els.adblock.checked = settings.get("adblock", "1") === "1";
	AdGuardDNS.enabled = els.adblock.checked;
	els.saveHistory.checked = settings.get("saveHistory", "1") === "1";
	browsingHistory.load();

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
		els.bar.value = tab.url;
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
		if (tab === activeTab && document.activeElement !== els.bar && els.bar.value !== tab.url) {
			els.bar.value = tab.url;
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
	$("show-history").addEventListener("click", openHistory);
	$("show-settings").addEventListener("click", () => els.settingsPanel.showModal());
	$("open-settings").addEventListener("click", () => els.settingsPanel.showModal());
	$("settings-close").addEventListener("click", () => els.settingsPanel.close());
	$("external").addEventListener("click", () => {
		const url = activeTab.frame && currentRealUrl(activeTab);
		if (url) window.open(url, "_blank", "noopener");
	});

	els.historySearch.addEventListener("input", renderHistory);
	$("history-close").addEventListener("click", () => els.historyPanel.close());
	$("history-clear").addEventListener("click", () => {
		if (!browsingHistory.entries.length || !confirm("Clear all browsing history?")) return;
		browsingHistory.clear();
		renderHistory();
	});
	// Clicking the backdrop (outside a panel) closes it.
	for (const panel of [els.settingsPanel, els.historyPanel]) {
		panel.addEventListener("click", (e) => {
			if (e.target === panel) panel.close();
		});
	}

	els.engine.addEventListener("change", () => settings.set("engine", els.engine.value));
	els.adblock.addEventListener("change", () => {
		AdGuardDNS.enabled = els.adblock.checked;
		settings.set("adblock", els.adblock.checked ? "1" : "0");
		setStatus(
			els.adblock.checked
				? "Blocking ads and trackers with AdGuard DNS."
				: "Ad and tracker blocking is off."
		);
	});
	els.saveHistory.addEventListener("change", () => {
		settings.set("saveHistory", els.saveHistory.checked ? "1" : "0");
	});

	async function reconnect(message) {
		if (!proxy) return;
		try {
			proxy.controller.setTransport(await createFilteredTransport(els.transport.value));
			setStatus(message);
		} catch (err) {
			setStatus("Couldn't switch transport: " + err.message, true);
		}
	}
	els.transport.addEventListener("change", () => {
		settings.set("transport", els.transport.value);
		reconnect(`Switched to ${els.transport.value}.`);
	});
	els.wisp.addEventListener("change", () => {
		const value = els.wisp.value.trim();
		if (value && !/^wss?:\/\/[^/]/.test(value)) {
			setStatus("Wisp server must be a ws:// or wss:// URL.", true);
			return;
		}
		settings.set("wisp", value);
		reconnect(`Using Wisp server ${value || defaultWisp()}.`);
	});

	createTab();
}

main();
