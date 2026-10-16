"use strict";

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
			hosts: ["tidal.com"],
			color: "#fff",
			d: "M12.012 3.992L8.008 7.996 4.004 3.992 0 7.996 4.004 12l4.004-4.004L12.012 12l-4.004 4.004 4.004 4.004 4.004-4.004L12.012 12l4.004-4.004-4.004-4.004zM16.042 7.996l3.979-3.979L24 7.996l-3.979 3.979z",
		},
	];

	const DEFAULTS = [
		{ name: "YouTube", url: "https://www.youtube.com/" },
		{ name: "TikTok", url: "https://www.tiktok.com/" },
		{ name: "Discord", url: "https://discord.com/app" },
		{ name: "Twitch", url: "https://www.twitch.tv/" },
		{ name: "Music", url: "https://listen.tidal.com/" },
	];

	// Defaults added after people may already have saved their own list; each is
	// appended once to saved lists that don't have it.
	const ADDED_LATER = [{ version: 2, name: "Music", url: "https://listen.tidal.com/" }];
	const VERSION_KEY = "sj2:shortcutsVersion";

	function load() {
		try {
			const saved = JSON.parse(localStorage.getItem(KEY));
			if (Array.isArray(saved)) {
				const list = saved.filter((s) => s && s.name && s.url);
				// The Tidal tile was renamed to Music.
				for (const s of list) if (s.name === "Tidal" && s.url.includes("tidal.com")) s.name = "Music";
				const version = Number(localStorage.getItem(VERSION_KEY)) || 1;
				for (const extra of ADDED_LATER) {
					const host = new URL(extra.url).hostname;
					if (extra.version > version && !list.some((s) => s.url.includes(host)) && list.length < MAX) {
						list.push({ name: extra.name, url: extra.url });
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
		const brand = brandFor(shortcut.url);
		if (brand) {
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("aria-hidden", "true");
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("fill", brand.color);
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
	};
})();

// Animated wallpapers drawn on the home screen's canvas. Each start() returns a stop().
// They only animate while the home screen is on screen and the page is visible.
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

// Drifting points joined by faint lines.
self.Constellation = {
	start(canvas, color = "167 139 250") {
		let points = [];
		function draw(ctx, width, height) {
			ctx.clearRect(0, 0, width, height);
			const reach = Math.min(140, Math.max(90, width / 8));
			for (let i = 0; i < points.length; i++) {
				const a = points[i];
				for (let j = i + 1; j < points.length; j++) {
					const b = points[j];
					const d = Math.hypot(a.x - b.x, a.y - b.y);
					if (d < reach) {
						ctx.strokeStyle = `rgb(${color} / ${0.22 * (1 - d / reach)})`;
						ctx.lineWidth = 1;
						ctx.beginPath();
						ctx.moveTo(a.x, a.y);
						ctx.lineTo(b.x, b.y);
						ctx.stroke();
					}
				}
			}
			ctx.fillStyle = `rgb(${color} / 0.7)`;
			for (const p of points) {
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		return animateCanvas(canvas, {
			setup(width, height) {
				const count = Math.min(90, Math.round((width * height) / 14000));
				points = Array.from({ length: count }, () => ({
					x: Math.random() * width,
					y: Math.random() * height,
					vx: (Math.random() - 0.5) * 0.25,
					vy: (Math.random() - 0.5) * 0.25,
					r: Math.random() * 1.2 + 0.6,
				}));
			},
			frame(ctx, width, height) {
				for (const p of points) {
					p.x += p.vx;
					p.y += p.vy;
					if (p.x < -10) p.x = width + 10;
					else if (p.x > width + 10) p.x = -10;
					if (p.y < -10) p.y = height + 10;
					else if (p.y > height + 10) p.y = -10;
				}
				draw(ctx, width, height);
			},
			still: draw,
		});
	},
};

// Falling snow: near flakes are bigger, brighter and faster, and every flake sways.
self.Snowfall = {
	start(canvas) {
		let flakes = [];
		let t = 0;
		function draw(ctx, width, height) {
			ctx.clearRect(0, 0, width, height);
			for (const f of flakes) {
				ctx.fillStyle = `rgb(255 255 255 / ${f.alpha})`;
				ctx.beginPath();
				ctx.arc(f.x + Math.sin(t * f.sway + f.phase) * f.drift, f.y, f.r, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		return animateCanvas(canvas, {
			setup(width, height) {
				const count = Math.min(260, Math.round((width * height) / 5000));
				flakes = Array.from({ length: count }, () => {
					const depth = Math.random();
					return {
						x: Math.random() * width,
						y: Math.random() * height,
						r: 0.8 + depth * 2.6,
						speed: 0.35 + depth * 1.2,
						alpha: 0.35 + depth * 0.6,
						drift: 6 + depth * 18,
						sway: 0.01 + Math.random() * 0.02,
						phase: Math.random() * Math.PI * 2,
					};
				});
			},
			frame(ctx, width, height) {
				t++;
				for (const f of flakes) {
					f.y += f.speed;
					if (f.y > height + 6) {
						f.y = -6;
						f.x = Math.random() * width;
					}
				}
				draw(ctx, width, height);
			},
			still: draw,
		});
	},
};
