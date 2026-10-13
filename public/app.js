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
	toolbar: $("toolbar"),
	home: $("home-screen"),
	frame: $("frame"),
	bar: $("bar"),
	barForm: $("bar-form"),
	search: $("search"),
	searchForm: $("search-form"),
	status: $("status"),
	transport: $("transport"),
	wisp: $("wisp"),
	engine: $("engine"),
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
};

function setStatus(text, isError = false) {
	els.status.textContent = text;
	els.status.classList.toggle("error", isError);
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

async function boot() {
	if (!("serviceWorker" in navigator)) {
		throw new Error(
			"Service workers are unavailable. Open this site over HTTPS or on localhost (and not in a private window on Firefox)."
		);
	}

	const sw = await registerServiceWorker(PATHS.sw);
	await loadScript(PATHS.scramjet);
	await loadScript(PATHS.controllerApi);
	const transport = await createTransport(els.transport.value);

	const { Controller, config } = $scramjetController;
	config.prefix = PATHS.prefix;
	config.scramjetPath = PATHS.scramjet;
	config.wasmPath = PATHS.wasm;
	config.injectPath = PATHS.controllerInject;

	const controller = new Controller({ serviceworker: sw, transport });
	await controller.wait();
	return { controller, frame: controller.createFrame(els.frame) };
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

// Turns the iframe's proxied location back into the real URL it points at.
function currentRealUrl(frame) {
	try {
		const href = els.frame.contentWindow.location.href;
		const prefix = new URL(frame.prefix, location.href).href;
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

function showBrowser(visible) {
	els.home.hidden = visible;
	els.toolbar.hidden = !visible;
	els.frame.hidden = !visible;
	if (!visible) {
		els.frame.removeAttribute("src");
		els.search.value = "";
		els.search.focus();
	}
}

async function main() {
	els.transport.value = settings.get("transport", "libcurl");
	els.wisp.placeholder = defaultWisp();
	els.wisp.value = settings.get("wisp", "");
	els.engine.value = settings.get("engine", els.engine.options[0].value);
	if (!els.engine.value) els.engine.selectedIndex = 0;

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

	async function navigate(input) {
		const url = toUrl(input);
		if (!url) return;
		if (!proxy) setStatus("Still starting, one moment…");
		const { frame } = await ready;
		showBrowser(true);
		els.bar.value = url;
		frame.go(url);
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

	$("back").addEventListener("click", () => proxy?.frame.back());
	$("forward").addEventListener("click", () => proxy?.frame.forward());
	$("reload").addEventListener("click", () => proxy?.frame.reload());
	$("home").addEventListener("click", () => showBrowser(false));
	$("newtab").addEventListener("click", () => {
		const url = proxy && currentRealUrl(proxy.frame);
		if (url) window.open(url, "_blank", "noopener");
	});

	els.engine.addEventListener("change", () => settings.set("engine", els.engine.value));
	async function reconnect(message) {
		if (!proxy) return;
		try {
			proxy.controller.setTransport(await createTransport(els.transport.value));
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

	// Keep the address bar in sync, including SPA navigations that never fire "load".
	const syncBar = () => {
		if (!proxy || els.frame.hidden || document.activeElement === els.bar) return;
		const url = currentRealUrl(proxy.frame);
		if (url && url !== els.bar.value) els.bar.value = url;
	};
	els.frame.addEventListener("load", syncBar);
	setInterval(syncBar, 500);
}

main();
