"use strict";
// Wilbert X: games from two collections, listed in ugs-files.js (bubbls/ugs-singlefile) and
// gn-files.js (Gn-Math). Each game is one HTML file; opening one fetches it and runs it in a
// new about:blank tab.
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

const GAMES = [
	...(self.UGS_FILES || []).map(([file, name]) => ({ source: "ugs", file, name })),
	...(self.GN_FILES || []).map(([file, name]) => ({ source: "gn", file, name })),
].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

const $ = (id) => document.getElementById(id);
const list = $("list");
const empty = $("empty");
const search = $("search");

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
	const doc = win.document;
	doc.title = game.name;
	doc.body.style.cssText = "margin:0;height:100vh;overflow:hidden;background:#07080c;color:#8b8e98;font:14px system-ui,sans-serif";
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

function row(game) {
	const li = document.createElement("li");
	const button = document.createElement("button");
	button.type = "button";
	button.className = "item";
	const title = document.createElement("span");
	title.textContent = game.name;
	button.append(title);
	button.addEventListener("click", () => openGame(game));
	li.append(button);
	return li;
}

function render() {
	const q = search.value.trim().toLowerCase();
	const shown = q ? GAMES.filter((g) => g.name.toLowerCase().includes(q)) : GAMES;
	list.replaceChildren(...shown.map(row));
	empty.textContent = GAMES.length ? "No results" : "No games yet";
	empty.hidden = shown.length > 0;
}

search.addEventListener("input", render);
search.addEventListener("keydown", (e) => {
	if (e.key === "Enter") list.querySelector(".item")?.click();
});

render();
