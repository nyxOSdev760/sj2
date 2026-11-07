"use strict";
// CloudGames: the game list. Add a game as [name, url], e.g.
//   ["My Game", "https://example.com/play"],
const GAMES = [];

const $ = (id) => document.getElementById(id);
const list = $("list");
const empty = $("empty");
const search = $("search");

function render() {
	const q = search.value.trim().toLowerCase();
	const shown = q ? GAMES.filter(([name]) => name.toLowerCase().includes(q)) : GAMES;
	list.replaceChildren(
		...shown.map(([name, url]) => {
			const li = document.createElement("li");
			const a = document.createElement("a");
			a.className = "item";
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			const title = document.createElement("span");
			title.textContent = name;
			const open = document.createElement("span");
			open.className = "open";
			open.textContent = "Open";
			a.append(title, open);
			li.append(a);
			return li;
		})
	);
	empty.textContent = GAMES.length ? "No results" : "No games yet";
	empty.hidden = shown.length > 0;
}

search.addEventListener("input", render);
search.addEventListener("keydown", (e) => {
	if (e.key === "Enter") list.querySelector(".item")?.click();
});

render();
