"use strict";
// WX: the game library. Games come from two collections, listed in ugs-files.js
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

// The game runs in a full-window frame inside a new about:blank tab, so the tab's address
// stays about:blank.
async function openGame(game) {
	// Open the tab right away (inside the click) so pop-up blockers allow it.
	const win = window.open("about:blank", "_blank");
	if (!win) return;
	recents = [game.id, ...recents.filter((id) => id !== game.id)].slice(0, RECENTS_MAX);
	store.set("wx:recents", recents);
	if (view === "recent") apply();

	const doc = win.document;
	doc.title = game.name;
	doc.body.style.cssText = "margin:0;height:100vh;overflow:hidden;background:#120d1d;color:#9d8fbf;font:14px system-ui,sans-serif";
	const note = doc.createElement("div");
	note.style.cssText = "display:grid;place-items:center;height:100%";
	note.textContent = "Loading " + game.name + "…";
	doc.body.append(note);
	try {
		const html = await fetchGame(game);
		const frame = doc.createElement("iframe");
		frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff";
		frame.allow = "fullscreen; autoplay; gamepad; clipboard-write; pointer-lock";
		frame.allowFullscreen = true;
		frame.srcdoc = html;
		note.remove();
		doc.body.append(frame);
		frame.focus();
	} catch {
		note.textContent = "Couldn't load " + game.name + ". Try again.";
	}
}

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
	{ slug: "", name: "WX (default)", title: "WX", icon: "favicon.png" },
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

// Apply the chosen disguise to the tab title and favicon (unless the panic page is showing,
// which sets its own title).
function applyCloak() {
	const c = activeCloak();
	if ($("cloak").hidden) document.title = c.title;
	faviconEl.href = c.icon;
}

function selectCloak(slug) {
	cloakSlug = slug;
	store.set("wx:cloak", slug);
	applyCloak();
	for (const btn of cloakPresets.children) btn.classList.toggle("on", btn.dataset.slug === slug);
}

const cloakPresets = $("cloak-presets");
for (const c of CLOAKS) {
	const btn = el("button", "preset");
	btn.type = "button";
	btn.dataset.slug = c.slug;
	if (c.slug === cloakSlug) btn.classList.add("on");
	const img = el("img", "preset-icon");
	img.src = c.icon;
	img.alt = "";
	img.width = 28;
	img.height = 28;
	btn.append(img, el("span", "preset-name", c.name));
	btn.addEventListener("click", () => selectCloak(c.slug));
	cloakPresets.append(btn);
}
applyCloak();

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

function showCloak() {
	// Load the page only when first needed, then keep it so toggling is instant.
	if (cloakFrame.src !== panicUrl) cloakFrame.src = panicUrl;
	cloak.hidden = false;
	document.body.style.overflow = "hidden";
	document.title = "Clever | Log in";
}

function hideCloak() {
	cloak.hidden = true;
	document.body.style.overflow = "";
	applyCloak(); // restore the tab-cloak disguise (or "WX")
}

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

// Binding and triggering both happen on keydown, before anything else.
document.addEventListener(
	"keydown",
	(e) => {
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
		if (!panicKey || e.code !== panicKey) return;
		// Don't fire while typing in the search box or a settings field.
		const t = e.target;
		if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
		e.preventDefault();
		cloak.hidden ? showCloak() : hideCloak();
	},
	true
);

refreshPanicUI();
apply();
