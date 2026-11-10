"use strict";
// wilbert.: the game library. Games come from two collections, listed in ugs-files.js
// (bubbls/ugs-singlefile) and gn-files.js (Gn-Math): [file, name, cover?]. Each game is one
// HTML file; opening one fetches it and runs it in a new about:blank tab. Favorites and
// recently played games are kept in this browser's localStorage.
const SOURCES = {
	ugs: [
		"https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile@main/UGS-Files/",
		"https://raw.githubusercontent.com/bubbls/ugs-singlefile/main/UGS-Files/",
	],
	gn: [
		"https://cdn.jsdelivr.net/gh/freebuisness/html@main/",
		"https://raw.githubusercontent.com/freebuisness/html/main/",
	],
};
const GN_COVERS = "https://cdn.jsdelivr.net/gh/freebuisness/covers@main/";

const GAMES = [
	...(self.UGS_FILES || []).map(([file, name, cover]) => ({ source: "ugs", file, name, cover: cover || "" })),
	...(self.GN_FILES || []).map(([file, name, cover]) => ({ source: "gn", file, name, cover: cover ? GN_COVERS + cover : "" })),
].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
for (const g of GAMES) {
	g.id = g.source + ":" + g.file;
	g.key = g.name.toLowerCase();
}
const byId = new Map(GAMES.map((g) => [g.id, g]));

// ---- saved state ----

const store = {
	get(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			return raw == null ? fallback : JSON.parse(raw);
		} catch {
			return fallback;
		}
	},
	set(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// storage full or blocked: favorites just won't be remembered
		}
	},
};
const favs = new Set(store.get("wx:favs", []).filter((id) => byId.has(id)));
let recents = store.get("wx:recents", []).filter((id) => byId.has(id));
const RECENTS_MAX = 40;

let view = "all"; // all | favorites | recent
let source = "all"; // all | gn | ugs

const $ = (id) => document.getElementById(id);
const grid = $("grid");
const empty = $("empty");
const search = $("search");

// ---- opening a game ----

async function fetchGame(game) {
	let lastError;
	for (const base of SOURCES[game.source]) {
		try {
			const res = await fetch(base + encodeURIComponent(game.file));
			if (res.ok) return await res.text();
			lastError = new Error("HTTP " + res.status);
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError;
}

// Games play inside the site, in a full-screen player with a bar on top (back, full screen, CLOAK).

// Added to the start of every game page: it keeps a list of the game's Web Audio contexts so
// CLOAK can silence the game and bring the sound back afterwards.
const AUDIO_HOOK =
	"<script>(function(){var A=window.AudioContext||window.webkitAudioContext;if(!A)return;" +
	"var l=window.__wxAudio=[];function W(){var c=Reflect.construct(A,arguments,W);l.push(c);return c}" +
	"W.prototype=A.prototype;Object.setPrototypeOf(W,A);window.AudioContext=W;" +
	"if(window.webkitAudioContext)window.webkitAudioContext=W;})()<\/script>";

function withAudioHook(html) {
	const head = html.match(/<head[^>]*>/i);
	if (head) return html.replace(head[0], head[0] + AUDIO_HOOK);
	const doctype = html.match(/<!doctype[^>]*>/i);
	if (doctype) return html.replace(doctype[0], doctype[0] + AUDIO_HOOK);
	return AUDIO_HOOK + html;
}

const player = $("player");
const stage = $("player-stage");
let gameFrame = null;
let openToken = 0;

function enterFullscreen() {
	const req = player.requestFullscreen || player.webkitRequestFullscreen;
	if (req) Promise.resolve(req.call(player)).catch(() => {});
}

function exitFullscreen() {
	const fs = document.fullscreenElement || document.webkitFullscreenElement;
	const exit = document.exitFullscreen || document.webkitExitFullscreen;
	if (fs && exit) Promise.resolve(exit.call(document)).catch(() => {});
}

async function openGame(game) {
	recents = [game.id, ...recents.filter((id) => id !== game.id)].slice(0, RECENTS_MAX);
	store.set("wx:recents", recents);
	if (view === "recent") apply();

	const token = ++openToken;
	$("player-title").textContent = game.name;
	stage.replaceChildren(el("div", "player-note", "Loading " + game.name + "…"));
	player.hidden = false;
	document.body.style.overflow = "hidden";
	enterFullscreen(); // must happen inside the click, before anything async

	let html;
	try {
		html = await fetchGame(game);
	} catch {
		if (token === openToken) stage.replaceChildren(el("div", "player-note", "Couldn't load " + game.name + ". Try again."));
		return;
	}
	if (token !== openToken) return; // closed or another game opened meanwhile

	const frame = el("iframe", "player-frame");
	frame.title = game.name;
	frame.allow = "fullscreen; autoplay; gamepad; clipboard-write; pointer-lock";
	frame.allowFullscreen = true;
	frame.srcdoc = withAudioHook(html);
	// The game page shares the site's origin, so the panic key keeps working while it has focus.
	frame.addEventListener("load", () => {
		try {
			frame.contentWindow.addEventListener("keydown", onKeyDown, true);
		} catch {}
	});
	gameFrame = frame;
	stage.replaceChildren(frame);
	frame.focus();
}

function closeGame() {
	openToken++;
	exitFullscreen();
	gameFrame = null;
	stage.replaceChildren(); // removing the frame stops the game and its sound
	player.hidden = true;
	document.body.style.overflow = "";
}

// Silence (or bring back) the running game's sound.
function setGameMuted(muted) {
	const w = gameFrame?.contentWindow;
	if (!w) return;
	try {
		for (const ctx of w.__wxAudio || []) muted ? ctx.suspend() : ctx.resume();
		for (const m of w.document.querySelectorAll("audio, video")) {
			if (muted) {
				m.dataset.wxWasMuted = m.muted ? "1" : "";
				m.muted = true;
			} else if (!m.dataset.wxWasMuted) {
				m.muted = false;
			}
		}
	} catch {}
}

$("player-back").addEventListener("click", closeGame);
$("player-fs").addEventListener("click", () => {
	document.fullscreenElement || document.webkitFullscreenElement ? exitFullscreen() : enterFullscreen();
});

// ---- cards ----

// Games without a cover get a tile in one of these colors, picked from the name.
const TILE_COLORS = [
	["#7c3aed", "#c026d3"],
	["#6d28d9", "#2563eb"],
	["#9333ea", "#db2777"],
	["#4f46e5", "#7c3aed"],
	["#a21caf", "#7c3aed"],
	["#5b21b6", "#0891b2"],
];

function el(tag, cls, text) {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text != null) node.textContent = text;
	return node;
}

function placeholder(game) {
	let h = 0;
	for (const ch of game.name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
	const [a, b] = TILE_COLORS[h % TILE_COLORS.length];
	const tile = el("div", "tile");
	tile.style.background = `linear-gradient(135deg, ${a}, ${b})`;
	tile.append(el("span", "tile-name", game.name));
	return tile;
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" /></svg>';

function card(game) {
	const node = el("div", "card");
	node.tabIndex = 0;
	node.setAttribute("role", "button");
	node.title = game.name;

	const cover = el("div", "cover");
	if (game.cover) {
		const img = el("img");
		img.loading = "lazy";
		img.decoding = "async";
		img.alt = "";
		img.src = game.cover;
		img.addEventListener("error", () => img.replaceWith(placeholder(game)), { once: true });
		cover.append(img);
	} else {
		cover.append(placeholder(game));
	}

	const fav = el("button", "fav");
	fav.type = "button";
	fav.innerHTML = STAR;
	fav.addEventListener("click", (e) => {
		e.stopPropagation();
		if (favs.has(game.id)) favs.delete(game.id);
		else favs.add(game.id);
		store.set("wx:favs", [...favs]);
		markFav(game);
		if (view === "favorites") apply();
	});
	cover.append(fav);

	node.append(cover, el("div", "card-name", game.name));
	node.addEventListener("click", () => openGame(game));
	node.addEventListener("keydown", (e) => {
		if (e.target === node && (e.key === "Enter" || e.key === " ")) {
			e.preventDefault();
			openGame(game);
		}
	});
	game.el = node;
	game.favEl = fav;
	markFav(game);
	return node;
}

function markFav(game) {
	const on = favs.has(game.id);
	game.favEl.classList.toggle("on", on);
	game.favEl.setAttribute("aria-pressed", String(on));
	game.favEl.setAttribute("aria-label", (on ? "Remove " : "Add ") + game.name + (on ? " from favorites" : " to favorites"));
	game.favEl.title = on ? "Remove from favorites" : "Add to favorites";
}

// ---- filtering ----

const TITLES = { all: "Games", favorites: "Favorites", recent: "Recently played", settings: "Settings" };
const chips = document.querySelector(".chips");
const settingsPanel = $("settings");

// Every card is built once; switching views and searching only shows, hides and orders them.
function apply() {
	$("title-text").textContent = TITLES[view];
	// The Settings view replaces the game grid with the settings panel.
	$("hero").hidden = view !== "all";
	const isSettings = view === "settings";
	settingsPanel.hidden = !isSettings;
	chips.hidden = isSettings;
	grid.hidden = isSettings;
	search.style.visibility = isSettings ? "hidden" : "";
	if (isSettings) {
		empty.hidden = true;
		return;
	}
	const q = search.value.trim().toLowerCase();
	const recentRank = new Map(recents.map((id, i) => [id, i]));
	const inView = (g) => view === "all" || (view === "favorites" ? favs.has(g.id) : recentRank.has(g.id));
	const counts = { all: 0, gn: 0, ugs: 0 };
	let shown = 0;
	for (const g of GAMES) {
		const match = inView(g) && (!q || g.key.includes(q));
		if (match) {
			counts.all++;
			counts[g.source]++;
		}
		const visible = match && (source === "all" || g.source === source);
		g.el.hidden = !visible;
		g.el.style.order = view === "recent" && visible ? recentRank.get(g.id) : "";
		if (visible) shown++;
	}
	for (const chip of document.querySelectorAll(".chip")) {
		chip.querySelector(".chip-n").textContent = counts[chip.dataset.source];
	}
	empty.hidden = shown > 0;
	empty.textContent = q
		? `No games match "${search.value.trim()}".`
		: view === "favorites"
			? "No favorites yet. Tap the star on a game to add it here."
			: view === "recent"
				? "Games you open will show up here."
				: "No games.";
}

for (const btn of document.querySelectorAll(".side-btn")) {
	btn.addEventListener("click", () => {
		view = btn.dataset.view;
		for (const b of document.querySelectorAll(".side-btn")) b.classList.toggle("active", b === btn);
		apply();
		window.scrollTo(0, 0);
	});
}
for (const chip of document.querySelectorAll(".chip")) {
	chip.addEventListener("click", () => {
		source = chip.dataset.source;
		for (const c of document.querySelectorAll(".chip")) {
			c.classList.toggle("active", c === chip);
			c.setAttribute("aria-selected", String(c === chip));
		}
		apply();
	});
}
search.addEventListener("input", apply);
search.addEventListener("keydown", (e) => {
	if (e.key === "Enter") GAMES.find((g) => !g.el.hidden)?.el.click();
	if (e.key === "Escape") {
		search.value = "";
		apply();
	}
});
// "/" jumps to the search box.
document.addEventListener("keydown", (e) => {
	if (e.key === "/" && document.activeElement !== search && !e.ctrlKey && !e.metaKey) {
		e.preventDefault();
		search.focus();
	}
});

grid.append(...GAMES.map(card));

// ---- tab cloak: disguise this tab's name and icon ----

// slug -> { name (shown in settings), title (the tab title), icon (file in cloak/) }
const CLOAKS = [
	{ slug: "", name: "wilbert. (default)", title: "wilbert.", icon: "favicon.png" },
	{ slug: "classroom", name: "Google Classroom", title: "Classes", icon: "cloak/classroom.png" },
	{ slug: "docs", name: "Google Docs", title: "Untitled document - Google Docs", icon: "cloak/docs.png" },
	{ slug: "slides", name: "Google Slides", title: "Untitled presentation - Google Slides", icon: "cloak/slides.png" },
	{ slug: "drive", name: "Google Drive", title: "My Drive - Google Drive", icon: "cloak/drive.png" },
	{ slug: "gmail", name: "Gmail", title: "Inbox - Gmail", icon: "cloak/gmail.png" },
	{ slug: "google", name: "Google", title: "Google", icon: "cloak/google.png" },
	{ slug: "clever", name: "Clever", title: "Clever | Portal", icon: "cloak/clever.png" },
	{ slug: "canvas", name: "Canvas", title: "Dashboard", icon: "cloak/canvas.png" },
	{ slug: "khan", name: "Khan Academy", title: "Khan Academy | Free Online Courses", icon: "cloak/khan.png" },
	{ slug: "desmos", name: "Desmos", title: "Desmos | Graphing Calculator", icon: "cloak/desmos.png" },
	{ slug: "quizlet", name: "Quizlet", title: "Quizlet", icon: "cloak/quizlet.png" },
	{ slug: "wikipedia", name: "Wikipedia", title: "Wikipedia, the free encyclopedia", icon: "cloak/wikipedia.png" },
];
const faviconEl = $("favicon");
let cloakSlug = store.get("wx:cloak", "");

function activeCloak() {
	return CLOAKS.find((c) => c.slug === cloakSlug) || CLOAKS[0];
}

// When the site runs inside the about:blank tab's frame, the browser tab belongs to that outer
// page, so its title and icon are the ones to change.
function tabDoc() {
	try {
		if (window.top !== window.self && window.top.document) return window.top.document;
	} catch {}
	return document;
}

function setTabTitle(title) {
	document.title = title;
	const d = tabDoc();
	if (d !== document) d.title = title;
}

function setTabIcon(href) {
	faviconEl.href = href;
	const d = tabDoc();
	if (d === document) return;
	let link = d.querySelector("link[rel~='icon']");
	if (!link) {
		link = d.createElement("link");
		link.rel = "icon";
		d.head.appendChild(link);
	}
	link.href = new URL(href, location.href).href;
}

// Apply the chosen disguise to the tab title and favicon (unless the panic page is showing,
// which sets its own title).
function applyCloak() {
	const c = activeCloak();
	if ($("cloak").hidden) setTabTitle(c.title);
	setTabIcon(c.icon);
}

function selectCloak(slug) {
	cloakSlug = slug;
	store.set("wx:cloak", slug);
	applyCloak();
}

// A custom dropdown (so each option can show the site's favicon).
const ddBtn = $("cloak-dd-btn");
const ddMenu = $("cloak-dd-menu");
const ddIcon = ddBtn.querySelector(".dd-icon");
const ddLabel = ddBtn.querySelector(".dd-label");

function syncDd() {
	const c = activeCloak();
	ddIcon.src = c.icon;
	ddLabel.textContent = c.name;
	for (const opt of ddMenu.children) opt.classList.toggle("on", opt.dataset.slug === cloakSlug);
}

function openDd(open) {
	ddMenu.hidden = !open;
	ddBtn.setAttribute("aria-expanded", String(open));
}

for (const c of CLOAKS) {
	const opt = el("li", "dd-opt");
	opt.dataset.slug = c.slug;
	opt.setAttribute("role", "option");
	const img = el("img", "dd-icon");
	img.src = c.icon;
	img.alt = "";
	img.width = 22;
	img.height = 22;
	opt.append(img, el("span", "dd-opt-name", c.name));
	const check = el("span", "dd-check");
	check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>';
	opt.append(check);
	opt.addEventListener("click", () => {
		selectCloak(c.slug);
		syncDd();
		openDd(false);
	});
	ddMenu.append(opt);
}

ddBtn.addEventListener("click", (e) => {
	e.stopPropagation();
	openDd(ddMenu.hidden);
});
document.addEventListener("click", (e) => {
	if (!$("cloak-dd").contains(e.target)) openDd(false);
});

applyCloak();
syncDd();

// ---- panic key: cover the whole site with another page ----

const DEFAULT_PANIC_URL = "https://clever.com/login";
let panicKey = store.get("wx:panicKey", null); // a KeyboardEvent.code, e.g. "Backquote"
let panicUrl = store.get("wx:panicUrl", DEFAULT_PANIC_URL);
let listening = false; // true while waiting for the user to press a key to bind

const cloak = $("cloak");
const cloakFrame = $("cloak-frame");
const panicKeyBtn = $("panic-key");
const panicClearBtn = $("panic-clear");
const panicUrlInput = $("panic-url");

// Turn a KeyboardEvent.code into something readable, e.g. "Backquote" -> "` (Backquote)".
function keyLabel(code) {
	if (!code) return "Not set";
	const map = { Backquote: "`", Escape: "Esc", Space: "Space", Backslash: "\\", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Minus: "-", Equal: "=" };
	let name = code;
	if (code.startsWith("Key")) name = code.slice(3);
	else if (code.startsWith("Digit")) name = code.slice(5);
	else if (code.startsWith("Arrow")) name = code.slice(5) + " arrow";
	else if (map[code]) name = map[code];
	return name;
}

function refreshPanicUI() {
	panicKeyBtn.textContent = listening ? "Press a key…" : keyLabel(panicKey);
	panicKeyBtn.classList.toggle("listening", listening);
	panicClearBtn.hidden = !panicKey || listening;
	panicUrlInput.value = panicUrl;
}

// CLOAK: cover the screen with the panic site AND disguise the tab as it, all at once.
function panicDisguise() {
	let host = "";
	try {
		host = new URL(panicUrl).hostname.replace(/^www\./, "");
	} catch {}
	if (/(^|\.)clever\.com$/.test(host)) return { title: "Clever | Log in", icon: "cloak/clever.png" };
	return { title: host || "New Tab", icon: "https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(host) };
}

function showCloak() {
	exitFullscreen(); // the cover has to be visible, and a full-screen game would sit on top
	setGameMuted(true);
	// Load the page only when first needed, then keep it so toggling is instant.
	if (cloakFrame.src !== panicUrl) cloakFrame.src = panicUrl;
	cloak.hidden = false;
	document.body.style.overflow = "hidden";
	const d = panicDisguise();
	setTabTitle(d.title);
	setTabIcon(d.icon);
	cloak.focus?.();
}

function hideCloak() {
	cloak.hidden = true;
	document.body.style.overflow = player.hidden ? "" : "hidden";
	applyCloak(); // restore the tab-cloak disguise (or the default)
	setGameMuted(false);
	if (!player.hidden) gameFrame?.focus();
}

// ---- CLOAK tutorial: shown the first time CLOAK is pressed, and from Settings ----

const tut = $("tut");
let tutThenCloak = false;

function showTutorial(thenCloak) {
	tutThenCloak = thenCloak;
	exitFullscreen(); // so the tutorial isn't hidden behind a full-screen game
	$("tut-key").textContent = panicKey ? "(" + keyLabel(panicKey) + ")" : "(set one in Settings)";
	$("tut-go").textContent = thenCloak ? "Got it, cloak now" : "Got it";
	tut.hidden = false;
	$("tut-go").focus();
}

function closeTutorial(cloakNow) {
	tut.hidden = true;
	store.set("wx:tutSeen", true);
	if (cloakNow) showCloak();
}

function requestCloak() {
	if (!store.get("wx:tutSeen", false)) showTutorial(true);
	else showCloak();
}

$("tut-go").addEventListener("click", () => closeTutorial(tutThenCloak));
$("tut-close").addEventListener("click", () => closeTutorial(false));
$("tut-show").addEventListener("click", () => showTutorial(false));

for (const b of document.querySelectorAll("[data-cloak]")) b.addEventListener("click", requestCloak);
$("cloak-exit").addEventListener("dblclick", hideCloak);

panicKeyBtn.addEventListener("click", () => {
	listening = true;
	refreshPanicUI();
});

panicClearBtn.addEventListener("click", () => {
	panicKey = null;
	store.set("wx:panicKey", null);
	refreshPanicUI();
});

panicUrlInput.addEventListener("change", () => {
	let v = panicUrlInput.value.trim();
	if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
	panicUrl = v || DEFAULT_PANIC_URL;
	store.set("wx:panicUrl", panicUrl);
	cloakFrame.src = ""; // reload with the new URL next time
	panicUrlInput.value = panicUrl;
});

// Binding and triggering both happen on keydown, before anything else. Also attached to the
// game frame while a game is open.
function onKeyDown(e) {
	if (listening) {
		e.preventDefault();
		// Esc cancels binding instead of setting Esc as the key.
		if (e.code !== "Escape") {
			panicKey = e.code;
			store.set("wx:panicKey", panicKey);
		}
		listening = false;
		refreshPanicUI();
		return;
	}
	// Esc also takes the cover away.
	if (!cloak.hidden && e.key === "Escape") {
		e.preventDefault();
		hideCloak();
		return;
	}
	if (!panicKey || e.code !== panicKey) return;
	// Don't fire while typing in the search box or a settings field.
	const t = e.target;
	if (t && t.ownerDocument === document && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
	e.preventDefault();
	cloak.hidden ? showCloak() : hideCloak();
}
document.addEventListener("keydown", onKeyDown, true);

refreshPanicUI();

// ---- auto about:blank (the opening itself happens in index.html, before anything loads) ----

const autoBlankBtn = $("auto-blank");
function refreshAutoBlank() {
	const on = store.get("wx:autoBlank", true) !== false;
	autoBlankBtn.setAttribute("aria-checked", String(on));
	autoBlankBtn.classList.toggle("on", on);
}
autoBlankBtn.addEventListener("click", () => {
	store.set("wx:autoBlank", store.get("wx:autoBlank", true) === false);
	refreshAutoBlank();
});
refreshAutoBlank();

// The popup was blocked on load: offer to open it with a click, which browsers allow.
if (window.wxBlankBlocked) {
	const prompt = $("blank-prompt");
	prompt.hidden = false;
	$("blank-open").addEventListener("click", () => {
		if (window.wxOpenBlank()) prompt.hidden = true;
	});
	$("blank-stay").addEventListener("click", () => {
		prompt.hidden = true;
	});
}

apply();
