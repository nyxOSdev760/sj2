"use strict";
/* filler: c__o__d__e */
// Home screen pieces: the editable shortcut tiles and the constellation background.

self.Shortcuts = (() => {
	const KEY = "sj2:shortcuts";
	const MAX = 24;

	// Brand logos from Simple Icons (CC0), https://simpleicons.org, matched by host.
	const BRANDS = [
		{
			hosts: ["youtube.com", "youtu.be"],
			color: "#FF0000",
			d: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
		},
		{
			hosts: ["tiktok.com"],
			color: "#fff",
			d: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
		},
		{
			hosts: ["discord.com", "discord.gg"],
			color: "#5865F2",
			d: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
		},
		{
			hosts: ["twitch.tv"],
			color: "#9146FF",
			d: "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
		},
		{
			hosts: ["audiomack.com"],
			color: "#FFA200",
			d: "M.331 11.378s.5418-.089.765.1439c.2234.2332.077.7156-.2195.7237-.2965.01-.5705.063-.765-.1439-.1946-.2066-.1424-.6218.2195-.7237m5.881 3.2925c-.0522.01-.1075-.018-.164-.059-.3884-.5413-.5287-2.3923-.707-2.5025-.185-.1144-.8545 1.0255-2.1862.903-.5569-.051-1.1236-.4121-1.4573-.662.031-.4206.0364-1.4027.8659-1.0833.5038.1939 1.3667.7266 2.1245-.23.8378-1.0579 1.2999-.7506 1.577-.5206.2771.23.0925 1.4259.5058 1.0916.4133-.3343 2.082-2.4103 2.082-2.4103s1.292-1.303 1.4898.067c.1979 1.3698 1.0403 2.8877 1.2635 2.8445.2234-.043 2.8223-5.3253 3.1945-5.666.3722-.3409 1.6252-.2961 1.5657.5781-.0596.8742-.1871 6.308-.1871 6.308s-.147 1.5311.0924.7128c.0992-.3392.206-.6453.3392-1.0024.6414-2.0534 1.734-5.5613 2.2784-7.3688.1252-.4325.233-.8037.3166-1.0891l.0001-.0008a3.5925 3.5925 0 0 1 .0973-.3305c.0455-.1532.0763-.2546.0858-.2813.0243-.068.0925-.1192.1884-.157.0962-.061.1995-.064.3165-.067.3021-.027.6907.012 1.0401.1119.1018 0 .2125.037.3172.1118v.0001s.0063 0 .0151.01c.0023 0 .0048 0 .0073.01.0219.015.0573.045.0983.095.0012 0 .0025 0 .004.01.017.021.0341.045.0515.073.1952.2863.315.814.1948 1.7498-.2996 2.3354-.5316 7.1397-.5316 7.1397s-.0461.2298.4353-.782c.0167-.035.0383-.066.058-.098.026-.017.0552-.042.0913-.085.2974-.3546 1.0968-.5629 1.6512-.5586.2336.028.4293.087.5462.1609.2188.333.0897 1.562.0897 1.562-.4612.043-1.3403.2908-1.6519.3366-.3118.046-.7852 2.0699-1.4433 1.8629-.6581-.2069-2.1246-1.1268-2.1246-1.2533 0-.1102.1152-1.4546.1453-1.8016.0022-.024.004-.046.0058-.068a.152.152 0 0 1 .0014-.014l-.0002.0003c.0213-.2733.0023-.3927-.1239-.1199-.1086.2346-.581 1.7359-1.1078 3.3709-.0556.1429-1.0511 3.1558-1.1818 3.5231-.156.4261-.287.7523-.3776.921-.1378.1867-.3234.3036-.5826.2252-.6465-.1954-1.4654-1.0889-1.473-1.3106-.0155-1.2503.0608-7.973-.2423-7.4127-.311.5744-2.73 4.5608-2.73 4.5608-.0405.01-.0705.01-.1062.01-.1712-.019-.4366-.074-.51-.2384-.004-.01-.0094-.018-.0129-.028-.0035-.01-.0075-.022-.0135-.04-.0329-.1097-.0463-.2289-.0753-.3265-.1082-.3652-.2813-.8886-.463-1.421-.2784-.9079-.5654-1.8366-.6127-1.9391-.0923-.2007-.2268-.116-.3475-.0002-.54.458-1.6868 2.4793-2.7225 2.5898",
		},
		{
			hosts: ["soundcloud.com"],
			color: "#FF5500",
			d: "M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z",
		},
	];

	const GAMEPAD_ICON =
		"M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-3.96 3.43l-.9 6.32a2.5 2.5 0 0 0 4.5 1.85L8 15h8l1.66 1.6a2.5 2.5 0 0 0 4.5-1.85l-.9-6.32A4 4 0 0 0 17.3 5z";
	const MUSIC_ICON = "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";
	const FILM_ICON = "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4";

	const DEFAULTS = [
		{ name: "Movies", url: "arc4dia://movies" },
		{ name: "Music", url: "arc4dia://music" },
		{ name: "Games", url: "arc4dia://games" },
		{ name: "YouTube", url: "https://www.youtube.com/" },
		{ name: "TikTok", url: "https://www.tiktok.com/" },
		{ name: "Discord", url: "https://discord.com/app" },
		{ name: "Twitch", url: "https://www.twitch.tv/" },
	];
/* filler: c__o__d__e */
	// Defaults added after people may already have saved their own list; each is
	// appended once to saved lists that don't have it.
	const ADDED_LATER = [
		{ version: 3, name: "AI", url: "arc4dia://ai" },
		{ version: 4, name: "TikTok", url: "https://www.tiktok.com/" },
		{ version: 5, name: "Games", url: "arc4dia://games" },
		{ version: 6, name: "Movies", url: "arc4dia://movies" },
		{ version: 7, name: "Music", url: "arc4dia://music" },
	];
	const VERSION_KEY = "sj2:shortcutsVersion";

	function load() {
		try {
			const saved = JSON.parse(localStorage.getItem(KEY));
			if (Array.isArray(saved)) {
				const list = saved.filter((s) => s && s.name && s.url);
				// Built-in tiles saved before the rename to Arc4dia.
				for (const s of list) s.url = s.url.replace(/^(skyline|skeld):/, "arc4dia:");
				// The old Music tiles (Audiomack, SoundCloud) go; Music is arc4dia://music (Ripple) now.
				for (let i = list.length - 1; i >= 0; i--) {
					if (list[i].name === "Music" && /(audiomack|soundcloud|tidal)\.com/.test(list[i].url)) list.splice(i, 1);
				}
				// AI and chat were removed.
				for (let i = list.length - 1; i >= 0; i--) {
					if (/^arc4dia:\/\/(ai|chat)\/?$/i.test(list[i].url)) list.splice(i, 1);
				}
				const version = Number(localStorage.getItem(VERSION_KEY)) || 1;
				for (const extra of ADDED_LATER) {
					const site = (url) => {
						try {
							const u = new URL(url);
							return u.protocol + u.host;
						} catch {
							return url;
						}
					};
					if (extra.version > version && !list.some((s) => site(s.url) === site(extra.url)) && list.length < MAX) {
						const tile = { name: extra.name, url: extra.url };
						// Built-in tiles go after the other built-in ones at the front.
						if (extra.url.startsWith("arc4dia:")) {
							let at = 0;
							while (at < list.length && list[at].url.startsWith("arc4dia:")) at++;
							list.splice(at, 0, tile);
						} else list.push(tile);
					}
				}
				localStorage.setItem(VERSION_KEY, String(ADDED_LATER.at(-1).version));
				localStorage.setItem(KEY, JSON.stringify(list));
				return list;
			}
		} catch {
			// storage unavailable or corrupt; fall back to the defaults
		}
		return DEFAULTS.map((s) => ({ ...s }));
	}

	let list = load();

	function save() {
		try {
			localStorage.setItem(KEY, JSON.stringify(list));
		} catch {
			// storage unavailable; shortcuts just won't persist
		}
	}
/* filler: c__o__d__e */
	function brandFor(url) {
		let host;
		try {
			host = new URL(url).hostname.replace(/^www\./, "");
		} catch {
			return null;
		}
		return BRANDS.find((b) => b.hosts.some((h) => host === h || host.endsWith("." + h))) || null;
	}

	function iconFor(shortcut) {
		// Built-in pages: a gamepad for arc4dia://games, a note for arc4dia://music, a film strip
		// for arc4dia://movies.
		if (shortcut.url.startsWith("arc4dia:")) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("aria-hidden", "true");
			svg.classList.add("internal-icon");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute(
				"d",
				shortcut.url.startsWith("arc4dia://games")
					? GAMEPAD_ICON
					: shortcut.url.startsWith("arc4dia://music")
						? MUSIC_ICON
						: FILM_ICON
			);
			svg.append(path);
			return svg;
		}
		const brand = brandFor(shortcut.url);
		if (brand) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("aria-hidden", "true");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			// White logos (TikTok, Tidal) follow the text colour so they show on light tiles.
			path.setAttribute("fill", brand.color === "#fff" ? "currentColor" : brand.color);
			path.setAttribute("d", brand.d);
			svg.append(path);
			return svg;
		}
		// No brand logo: the first letter, tinted by a hue derived from the name.
		const letter = document.createElement("span");
		letter.className = "shortcut-letter";
		letter.textContent = [...shortcut.name.trim()][0]?.toUpperCase() || "?";
		let hue = 0;
		for (const ch of shortcut.name) hue = (hue * 31 + ch.codePointAt(0)) % 360;
		letter.style.color = `hsl(${hue} 80% 72%)`;
		return letter;
	}

	return {
		get list() {
			return list;
		},
		get full() {
			return list.length >= MAX;
		},
		add(name, url) {
			if (list.length >= MAX) return false;
			list.push({ name, url });
			save();
			return true;
		},
		remove(index) {
			list.splice(index, 1);
			save();
		},
		reset() {
			list = DEFAULTS.map((s) => ({ ...s }));
			save();
		},
		iconFor,
		// The site's logo as an <svg>, or null when it isn't a known brand.
		brandIcon(url) {
			return brandFor(url) ? iconFor({ name: "", url }) : null;
		},
	};
})();

// The home screen's animated background, drawn on a canvas. start() returns a stop().
// It only animates while the home screen is on screen and the page is visible.
function animateCanvas(canvas, { setup, frame, still }) {
	const ctx = canvas.getContext("2d");
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	let width = 0;
	let height = 0;
	let stopped = false;
	let timer = 0;
	let raf = 0;

	function resize() {
		const dpr = Math.min(devicePixelRatio || 1, 2);
		width = canvas.clientWidth;
		height = canvas.clientHeight;
		if (!width || !height) return;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		setup(width, height);
		if (reduced) still(ctx, width, height);
	}

	function loop() {
		if (stopped) return;
		if (!document.hidden && canvas.offsetParent !== null) {
			if (canvas.clientWidth !== width || canvas.clientHeight !== height) resize();
			frame(ctx, width, height);
			raf = requestAnimationFrame(loop);
		} else {
			timer = setTimeout(loop, 400);
		}
	}

	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	resize();
	if (!reduced) loop();

	return () => {
		stopped = true;
		cancelAnimationFrame(raf);
		clearTimeout(timer);
		observer.disconnect();
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	};
}

// A night sky: faint twinkling dust, and brighter stars drifting slowly, joined by thin
// lines when they come near each other. `color` is "r g b".
self.Constellation = {
	start(canvas, color = "150 230 190") {
		let dust = [];
		let stars = [];
		let reach = 160;
		let t = 0;
		function draw(ctx, width, height) {
			ctx.clearRect(0, 0, width, height);
			for (const d of dust) {
				const alpha = d.alpha * (0.6 + 0.4 * Math.sin(t * d.speed + d.phase));
				ctx.fillStyle = `rgb(${color} / ${alpha})`;
				ctx.fillRect(d.x, d.y, d.r, d.r);
			}
			ctx.lineWidth = 1;
			for (let i = 0; i < stars.length; i++) {
				const a = stars[i];
				for (let j = i + 1; j < stars.length; j++) {
					const b = stars[j];
					const d = Math.hypot(a.x - b.x, a.y - b.y);
					if (d < reach) {
						ctx.strokeStyle = `rgb(${color} / ${0.28 * (1 - d / reach)})`;
						ctx.beginPath();
						ctx.moveTo(a.x, a.y);
						ctx.lineTo(b.x, b.y);
						ctx.stroke();
					}
				}
			}
			for (const s of stars) {
				const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
				glow.addColorStop(0, `rgb(${color} / 0.55)`);
				glow.addColorStop(1, `rgb(${color} / 0)`);
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = `rgb(${color} / 0.95)`;
				ctx.beginPath();
				ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		return animateCanvas(canvas, {
			setup(width, height) {
				reach = Math.min(240, Math.max(130, width / 6));
				dust = Array.from({ length: Math.min(260, Math.round((width * height) / 5000)) }, () => ({
					x: Math.random() * width,
					y: Math.random() * height,
					r: Math.random() < 0.85 ? 1 : 2,
					alpha: 0.12 + Math.random() * 0.45,
					speed: 0.01 + Math.random() * 0.03,
					phase: Math.random() * Math.PI * 2,
				}));
				stars = Array.from({ length: Math.min(46, Math.round((width * height) / 26000)) }, () => ({
					x: Math.random() * width,
					y: Math.random() * height,
					vx: (Math.random() - 0.5) * 0.18,
					vy: (Math.random() - 0.5) * 0.18,
					r: 1.4 + Math.random() * 1.4,
				}));
			},
			frame(ctx, width, height) {
				t++;
				for (const s of stars) {
					s.x += s.vx;
					s.y += s.vy;
					if (s.x < -20) s.x = width + 20;
					else if (s.x > width + 20) s.x = -20;
					if (s.y < -20) s.y = height + 20;
					else if (s.y > height + 20) s.y = -20;
				}
				draw(ctx, width, height);
			},
			still: draw,
		});
	},
};
