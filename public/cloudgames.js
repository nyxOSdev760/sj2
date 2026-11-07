"use strict";
// CloudGames: the game library. Add a game as [name, url], e.g.
//   ["My Game", "https://example.com/play"],
const GAMES = [];

const $ = (id) => document.getElementById(id);
const grid = $("grid");
const count = $("count");
const empty = $("empty");
const search = $("search");

// Each card gets its own color pair, picked from the name so it stays the same.
const PALETTE = [
	["#6d5dfc", "#22d3ee"],
	["#f472b6", "#8b5cf6"],
	["#34d399", "#3b82f6"],
	["#f59e0b", "#ef4444"],
	["#22d3ee", "#10b981"],
	["#a78bfa", "#f472b6"],
];

function colors(name) {
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
	return PALETTE[h % PALETTE.length];
}

function card([name, url]) {
	const a = document.createElement("a");
	a.className = "card";
	a.href = url;
	a.target = "_blank";
	a.rel = "noopener noreferrer";
	const [c1, c2] = colors(name);
	a.style.setProperty("--c1", c1);
	a.style.setProperty("--c2", c2);

	const art = document.createElement("span");
	art.className = "card-art";
	art.textContent = name.trim().charAt(0).toUpperCase();

	const body = document.createElement("span");
	body.className = "card-body";
	const title = document.createElement("span");
	title.className = "card-title";
	title.textContent = name;
	const play = document.createElement("span");
	play.className = "card-play";
	play.textContent = "Play";
	body.append(title, play);

	a.append(art, body);
	return a;
}

function render() {
	const q = search.value.trim().toLowerCase();
	const shown = q ? GAMES.filter(([name]) => name.toLowerCase().includes(q)) : GAMES;
	grid.replaceChildren(...shown.map(card));
	count.textContent = `${GAMES.length} ${GAMES.length === 1 ? "game" : "games"}`;
	empty.hidden = shown.length > 0;
	if (!GAMES.length) {
		$("empty-title").textContent = "No games yet";
		$("empty-text").textContent = "New games are on the way. Check back soon.";
	} else {
		$("empty-title").textContent = "Nothing found";
		$("empty-text").textContent = `No games match "${search.value.trim()}".`;
	}
}

search.addEventListener("input", render);
search.addEventListener("keydown", (e) => {
	if (e.key === "Enter") grid.querySelector(".card")?.click();
	if (e.key === "Escape") {
		search.value = "";
		render();
	}
});
// "/" jumps to the search box.
document.addEventListener("keydown", (e) => {
	if (e.key === "/" && document.activeElement !== search) {
		e.preventDefault();
		search.focus();
	}
});

render();
