"use strict";
// Games catalog for arc4dia://games. Game names and cover art come from gn-math's public
// "zones" catalog; the single-file game HTML and the cover images are fetched from GitHub
// (jsDelivr blocks the gn-math user, so the raw host is used instead).
//
// The catalog is cached in localStorage, so reopening the tab is instant and still works if
// GitHub is briefly unreachable; a background fetch refreshes it. Favorites and a recently
// played list (also local) are pinned above the full grid.
self.Games = (() => {
	const CATALOG = "https://raw.githubusercontent.com/gn-math/assets/main/zones.json";
	const COVER_URL = "https://raw.githubusercontent.com/gn-math/covers/main";
	const HTML_URL = "https://raw.githubusercontent.com/gn-math/html/main";
	const resolve = (u) => u.replace("{COVER_URL}", COVER_URL).replace("{HTML_URL}", HTML_URL);

	const CACHE_KEY = "arc4dia:games:catalog";
	const FAVS_KEY = "arc4dia:games:favs";
	const RECENTS_KEY = "arc4dia:games:recents";
	const RECENTS_MAX = 12;
	const SKELETONS = 18;

	// localStorage is a per-viewer convenience here: every read and write is guarded so the
	// page works in a private window or with site data blocked.
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
				// storage full or unavailable; favourites just won't persist this session
			}
		},
	};

	let loaded = false;
	let games = [];
	let byId = new Map();
	let favs = store.get(FAVS_KEY, []).filter((id) => Number.isFinite(id));
	let recents = store.get(RECENTS_KEY, []).filter((id) => Number.isFinite(id));
	let query = "";
	let refs = null; // { content, pinned, allHeading, grid }

	function el(tag, cls, text) {
		const node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}

	function prepare(data) {
		// The catalog opens with a negative-id "suggest games" entry; keep only real games.
		return Array.isArray(data) ? data.filter((g) => g && g.id >= 0 && g.name && g.cover && g.url) : [];
	}

	function setGames(list) {
		games = list;
		byId = new Map(list.map((g) => [g.id, g]));
	}

	// ---- cards ----

	function card(game) {
		const wrap = el("div", "game-card");
		const open = el("button", "game-open");
		open.type = "button";
		open.title = game.name;
		const cover = el("span", "game-cover");
		const img = el("img");
		img.loading = "lazy";
		img.decoding = "async";
		img.alt = "";
		img.src = resolve(game.cover);
		img.addEventListener("error", () => wrap.classList.add("no-cover"));
		cover.append(img);
		open.append(cover, el("span", "game-title", game.name));
		open.addEventListener("click", () => launch(game));

		const fav = el("button", "game-fav");
		fav.type = "button";
		fav.textContent = "★";
		fav.dataset.favId = game.id;
		fav.setAttribute("aria-pressed", favs.includes(game.id) ? "true" : "false");
		fav.setAttribute("aria-label", "Favorite " + game.name);
		fav.title = "Favorite";
		fav.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleFav(game.id);
		});

		wrap.append(open, fav);
		return wrap;
	}

	function grid(list) {
		const node = el("div", "games-grid");
		node.append(...list.map(card));
		return node;
	}

	function shelf(title, list) {
		const section = el("section", "games-shelf");
		const heading = el("h2", "games-shelf-title", title);
		heading.append(el("span", "games-shelf-count", String(list.length)));
		section.append(heading, grid(list));
		return section;
	}

	// ---- launching ----

	// External games open directly; gn-math's own single-file games are fetched and written
	// into a blank tab (their <base href> points assets at jsDelivr, so they resolve there).
	function launch(game) {
		pushRecent(game.id);
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

	// ---- favorites / recents ----

	function toggleFav(id) {
		const at = favs.indexOf(id);
		if (at >= 0) favs.splice(at, 1);
		else favs.unshift(id);
		store.set(FAVS_KEY, favs);
		const pressed = favs.includes(id) ? "true" : "false";
		document.querySelectorAll('.game-fav[data-fav-id="' + id + '"]').forEach((b) => b.setAttribute("aria-pressed", pressed));
		renderPinned();
	}

	function pushRecent(id) {
		recents = [id, ...recents.filter((x) => x !== id)].slice(0, RECENTS_MAX);
		store.set(RECENTS_KEY, recents);
		renderPinned();
	}

	// ---- rendering ----

	function buildShell() {
		const content = document.getElementById("games-content");
		if (!content) return;
		const pinned = el("div", "games-pinned");
		const section = el("section", "games-shelf");
		const allHeading = el("h2", "games-shelf-title", "All games");
		allHeading.hidden = true;
		const allGrid = el("div", "games-grid");
		section.append(allHeading, allGrid);
		content.replaceChildren(pinned, section);
		refs = { content, pinned, allHeading, grid: allGrid };
	}

	function renderPinned() {
		if (!refs) return;
		const recentGames = recents.map((id) => byId.get(id)).filter(Boolean);
		const favGames = favs.map((id) => byId.get(id)).filter(Boolean);
		const shelves = [];
		if (recentGames.length) shelves.push(shelf("Recently played", recentGames));
		if (favGames.length) shelves.push(shelf("Favorites", favGames));
		refs.pinned.replaceChildren(...shelves);
		refs.allHeading.hidden = query !== "" || shelves.length === 0;
	}

	function renderGrid(list) {
		if (refs) refs.grid.replaceChildren(...list.map(card));
	}

	function applyQuery() {
		if (!refs) return;
		if (query) {
			refs.pinned.hidden = true;
			renderGrid(games.filter((g) => g.name.toLowerCase().includes(query)));
		} else {
			refs.pinned.hidden = false;
			renderGrid(games);
		}
		renderPinned();
	}

	function paint() {
		if (!refs) buildShell();
		applyQuery();
	}

	function showSkeleton() {
		const content = document.getElementById("games-content");
		if (!content) return;
		const node = el("div", "games-grid");
		for (let i = 0; i < SKELETONS; i++) {
			const sk = el("div", "game-skeleton");
			sk.append(el("span", "sk-cover"), el("span", "sk-title"));
			node.append(sk);
		}
		content.replaceChildren(node);
		refs = null; // the shell is rebuilt once real data arrives
	}

	function showError() {
		const status = document.getElementById("games-status");
		if (status) {
			status.hidden = false;
			status.textContent = "Couldn't load the games catalog. Check your connection and reopen the tab.";
		}
	}

	async function load() {
		if (loaded) return;
		loaded = true;
		const status = document.getElementById("games-status");
		if (status) status.hidden = true;

		const cached = store.get(CACHE_KEY, null);
		if (cached && Array.isArray(cached.data) && cached.data.length) {
			setGames(cached.data);
			paint();
		} else {
			showSkeleton();
		}

		try {
			const res = await fetch(CATALOG + "?t=" + Date.now());
			if (!res.ok) throw new Error("HTTP " + res.status);
			const data = prepare(await res.json());
			if (!data.length) throw new Error("empty catalog");
			store.set(CACHE_KEY, { t: Date.now(), data });
			setGames(data);
			paint();
			if (status) status.hidden = true;
		} catch (err) {
			console.warn("Games catalog fetch failed:", err);
			// If a cached copy is already on screen, keep it; otherwise surface the error.
			if (!games.length) {
				loaded = false;
				showError();
			}
		}
	}

	// Called when the Games tab is opened.
	function show() {
		load();
		const search = document.getElementById("games-search");
		if (search && !search.dataset.wired) {
			search.dataset.wired = "1";
			search.addEventListener("input", () => {
				query = search.value.trim().toLowerCase();
				applyQuery();
			});
		}
	}

	return { show };
})();
