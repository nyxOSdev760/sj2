"use strict";
// Astra: a searchable list of apps. Each entry is a name and, optionally, the page it opens;
// entries without a URL open a web search for the name.
const APPS = [
	["Stumble Guys"],
	["Among Us", "https://now.gg/apps/innersloth-llc/4047/among-us.html"],
	["Call of Duty Mobile"],
	["Aptoide"],
	["Fortnite"],
	["The Battle Cats"],
	["Android"],
	["Discord", "https://now.gg/apps/discord-inc-/1430/discord-talk-chat-hang-out.html"],
	["Instagram", "https://now.gg/apps/instagram/1228/instagram.html"],
	["TikTok", "https://now.gg/apps/tiktok/4478/tiktok.html"],
	["Rocket League Sideswipe", "https://now.gg/apps/psyonix-studios/4656/rocket-league.html"],
	["EA SPORTS FC Mobile", "https://now.gg/apps/electronic-arts/1353/ea-sports-fc-mobile-24-soccer.html"],
	["Madden NFL 24 Mobile", "https://now.gg/apps/electronic-arts/1731/madden-nfl-24-mobile-football.html"],
	["EA SPORTS UFC Mobile 2", "https://now.gg/apps/electronic-arts/3288/ea-sports-ufc-mobile-2.html"],
	["Roblox"],
	["Minecraft"],
	["Subway Surfers"],
	["Brawl Stars"],
	["Clash Royale"],
	["Clash of Clans"],
	["Free Fire", "https://now.gg/apps/garena-international-i/1398/free-fire.html"],
	["PUBG Mobile", "https://now.gg/apps/proxima-beta/2609/pubg-mobile-resistance.html"],
	["Genshin Impact", "https://now.gg/apps/cognosphere-pte-ltd-/1773/genshin-impact.html"],
	["Geometry Dash", "https://now.gg/apps/robtop-games/1400/geometry-dash.html"],
	["8 Ball Pool"],
	["Pokémon GO"],
	["Candy Crush Saga"],
	["Hill Climb Racing"],
	["Temple Run 2"],
	["Crossy Road"],
	["Fruit Ninja"],
	["Angry Birds 2"],
	["Plants vs. Zombies 2"],
	["Asphalt 9"],
	["Mobile Legends"],
	["Brawlhalla"],
	["Shadow Fight 3"],
	["Dragon City"],
	["Hay Day"],
	["Gacha Club"],
	["Toca Life World"],
	["My Talking Tom 2"],
	["Snapchat"],
	["WhatsApp"],
	["Telegram"],
	["YouTube"],
	["Spotify"],
	["Netflix"],
	["Twitch"],
	["Reddit"],
	["Pinterest"],
	["X"],
	["Facebook"],
	["Messenger"],
	["Google Chrome"],
	["Google Play Store"],
	["CapCut"],
	["Duolingo"],
	["ChatGPT"],
	["Zoom"],
];

const $ = (id) => document.getElementById(id);
const list = $("list");
const count = $("count");
const empty = $("empty");
const search = $("search");

function urlFor([name, url]) {
	return url || "https://duckduckgo.com/?q=" + encodeURIComponent(name);
}

function render() {
	const q = search.value.trim().toLowerCase();
	const shown = q ? APPS.filter(([name]) => name.toLowerCase().includes(q)) : APPS;
	list.replaceChildren(
		...shown.map((app) => {
			const li = document.createElement("li");
			const a = document.createElement("a");
			a.className = "item";
			a.href = urlFor(app);
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			const name = document.createElement("span");
			name.textContent = app[0];
			const open = document.createElement("span");
			open.className = "open";
			open.textContent = "Open";
			a.append(name, open);
			li.append(a);
			return li;
		})
	);
	count.textContent = `${shown.length} available`;
	empty.hidden = shown.length > 0;
}

search.addEventListener("input", render);
search.addEventListener("keydown", (e) => {
	if (e.key === "Enter") list.querySelector(".item")?.click();
});

// Hamburger menu.
const menu = $("menu");
const menuButton = $("menu-button");
menuButton.addEventListener("click", (e) => {
	e.stopPropagation();
	menu.hidden = !menu.hidden;
	menuButton.setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", () => {
	menu.hidden = true;
	menuButton.setAttribute("aria-expanded", "false");
});

$("full-link").addEventListener("click", (e) => {
	e.preventDefault();
	if (document.fullscreenElement) document.exitFullscreen();
	else document.documentElement.requestFullscreen?.();
});
$("browser-link").addEventListener("click", (e) => e.preventDefault());

render();
