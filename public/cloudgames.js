"use strict";
// CloudGames: the games from bubbls/ugs-singlefile (list in ugs-files.js). Each game is one
// HTML file; opening one fetches it and writes it into a new tab, as the original site does.
const SOURCES = [
	"https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile@main/UGS-Files/",
	"https://raw.githubusercontent.com/bubbls/ugs-singlefile/main/UGS-Files/",
];

// "clA Walk in The Forest (v10).html" -> "A Walk in The Forest (v10)"
const GAMES = (self.UGS_FILES || []).map((file) => ({
	file,
	name: file.replace(/^cl/, "").replace(/\.html?$/i, ""),
}));

const $ = (id) => document.getElementById(id);
const list = $("list");
const empty = $("empty");
const search = $("search");

async function fetchGame(file) {
	let lastError;
	for (const base of SOURCES) {
		try {
			const res = await fetch(base + encodeURIComponent(file));
			if (res.ok) return await res.text();
			lastError = new Error("HTTP " + res.status);
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError;
}

async function openGame(game) {
	// Open the tab right away (inside the click) so pop-up blockers allow it.
	const win = window.open("about:blank", "_blank");
	if (!win) return;
	win.document.title = game.name;
	win.document.body.style.cssText = "margin:0;background:#07080c;color:#8b8e98;font:14px system-ui,sans-serif;display:grid;place-items:center;height:100vh";
	win.document.body.textContent = "Loading " + game.name + "…";
	try {
		const html = await fetchGame(game.file);
		win.document.open();
		win.document.write(html);
		win.document.close();
	} catch {
		win.document.body.textContent = "Couldn't load " + game.name + ". Try again.";
	}
}

function row(game) {
	const li = document.createElement("li");
	const button = document.createElement("button");
	button.type = "button";
	button.className = "item";
	const title = document.createElement("span");
	title.textContent = game.name;
	const open = document.createElement("span");
	open.className = "open";
	open.textContent = "Open";
	button.append(title, open);
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
