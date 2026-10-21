"use strict";
// Games catalog for arc4dia://games. Game names and cover art come from gn-math's public
// "zones" catalog; the single-file game HTML and the cover images are fetched from GitHub
// (jsDelivr blocks the gn-math user, so the raw host is used instead). The catalog is
// loaded the first time the Games tab is opened, not on every page load.
self.Games = (() => {
	const CATALOG = "https://raw.githubusercontent.com/gn-math/assets/main/zones.json";
	const COVER_URL = "https://raw.githubusercontent.com/gn-math/covers/main";
	const HTML_URL = "https://raw.githubusercontent.com/gn-math/html/main";
	const resolve = (u) => u.replace("{COVER_URL}", COVER_URL).replace("{HTML_URL}", HTML_URL);

	let loaded = false;
	let games = [];

	function el(tag, cls, text) {
		const node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}

	async function load() {
		if (loaded) return;
		loaded = true;
		const status = document.getElementById("games-status");
		try {
			const res = await fetch(CATALOG + "?t=" + Date.now());
			if (!res.ok) throw new Error("HTTP " + res.status);
			// Keep real games (the catalog starts with a negative-id "suggest games" entry).
			games = (await res.json()).filter((g) => g && g.id >= 0 && g.name && g.cover && g.url);
			if (status) status.hidden = true;
			render(games);
		} catch (err) {
			loaded = false; // let the next open try again
			if (status) {
				status.hidden = false;
				status.textContent = "Couldn't load the games catalog. Check your connection and reopen the tab.";
			}
			console.warn("Games catalog failed to load:", err);
		}
	}

	function render(list) {
		const grid = document.getElementById("games-grid");
		if (!grid) return;
		grid.replaceChildren(...list.map(card));
	}

	function card(game) {
		const button = el("button", "game-card");
		button.type = "button";
		button.title = game.name;
		const cover = el("span", "game-cover");
		const img = el("img");
		img.loading = "lazy";
		img.decoding = "async";
		img.alt = "";
		img.src = resolve(game.cover);
		img.addEventListener("error", () => button.classList.add("no-cover"));
		cover.append(img);
		button.append(cover, el("span", "game-title", game.name));
		button.addEventListener("click", () => launch(game));
		return button;
	}

	// External games open directly; gn-math's own single-file games are fetched and written
	// into a blank tab (their <base href> points assets at jsDelivr, so they resolve there).
	function launch(game) {
		const url = resolve(game.url);
		if (/^https?:\/\//.test(game.url)) {
			window.open(url, "_blank", "noopener");
			return;
		}
		// Open the window synchronously on the click so the popup blocker allows it.
		const win = window.open("about:blank", "_blank");
		if (!win) return;
		fetch(url + "?t=" + Date.now())
			.then((res) => res.text())
			.then((html) => {
				win.document.open();
				win.document.write(html);
				win.document.close();
			})
			.catch((err) => {
				console.warn("Game failed to load:", err);
				try {
					win.close();
				} catch {
					// already gone
				}
			});
	}

	function filter(query) {
		const q = query.trim().toLowerCase();
		render(q ? games.filter((g) => g.name.toLowerCase().includes(q)) : games);
	}

	// Called when the Games tab is opened.
	function show() {
		load();
		const search = document.getElementById("games-search");
		if (search && !search.dataset.wired) {
			search.dataset.wired = "1";
			search.addEventListener("input", () => filter(search.value));
		}
	}

	return { show };
})();
