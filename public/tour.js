"use strict";
/* filler: c__o__d__e */
// First-visit welcome tour: a five-step card with Skip / Back / Next.
self.Tour = (() => {
	const KEY = "sj2:tourDone";
	const APP = document.title;

	const ICONS = {
		sparkles:
			"M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z",
		tabs: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18",
		grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6M14 17h6",
		shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
		gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
		check: "M5 12l5 5L20 7",
		left: "M19 12H5M11 18l-6-6 6-6",
		right: "M5 12h14M13 6l6 6-6 6",
	};

	const STEPS = [
		{
			label: "Welcome",
			icon: "sparkles",
			title: `Welcome to ${APP}`,
			body: "A fast web proxy with tabs, games, movies and ad blocking built in. Take 20 seconds to get comfortable.",
		},
		{
			label: "Tabs",
			icon: "tabs",
			title: "Open as many tabs as you want",
			body: "Hit + up top for a new tab, and middle-click a tab to close it. Everything you visit lands in History, under ☰ in the toolbar.",
		},
		{
			label: "Shortcuts",
			icon: "grid",
			title: "Pin your sites",
			body: "Your shortcuts live in Apps on the desktop. Tap Add to pin a site, the trash can to drop one, or use ☰ → Bookmark this page while you browse.",
		},
		{
			label: "Blocking",
			icon: "shield",
			title: "Ads? Blocked.",
			body: `Ad and tracker domains are blocked automatically through AdGuard DNS. If a server goes down, ${APP} switches to another one on its own.`,
		},
		{
			label: "Settings",
			icon: "gear",
			title: "Make it yours",
			body: "The gear in the dock has your search engine, transport, Wisp server and history settings. History never leaves this browser.",
		},
	];

	function svg(name) {
		const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		node.setAttribute("viewBox", "0 0 24 24");
		node.setAttribute("aria-hidden", "true");
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", ICONS[name]);
		node.append(path);
		return node;
	}
	/* filler: c__o__d__e */
	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text != null) node.textContent = text;
		return node;
	}

	function seen() {
		try {
			return localStorage.getItem(KEY) === "1";
		} catch {
			return true; // can't remember it was seen, so don't nag on every visit
		}
	}

	function markSeen() {
		try {
			localStorage.setItem(KEY, "1");
		} catch {
			// storage unavailable
		}
	}

	let dialog = null;
	let current = 0;
	/* filler: c__o__d__e */
	function render() {
		const card = el("div", "tour-card");

		const stepper = el("div", "tour-steps");
		const pills = el("ol", "tour-pills");
		STEPS.forEach((step, i) => {
			const pill = el("li", "tour-pill");
			if (i < current) {
				pill.classList.add("done");
				pill.append(svg("check"));
				pill.setAttribute("aria-label", `${step.label}, done`);
			} else {
				pill.append(el("span", "tour-num", String(i + 1)));
				if (i === current) {
					pill.classList.add("current");
					pill.setAttribute("aria-current", "step");
					pill.append(el("span", "tour-pill-label", step.label));
				}
			}
			pills.append(pill);
		});
		const skip = el("button", "tour-skip", "Skip");
		skip.type = "button";
		skip.addEventListener("click", close);
		stepper.append(pills, skip);

		const step = STEPS[current];
		const badge = el("div", "tour-badge");
		badge.append(svg(step.icon));
		const title = el("h2", "tour-title", step.title);
		title.id = "tour-title";
		const body = el("p", "tour-body", step.body);

		const actions = el("div", "tour-actions");
		if (current > 0) {
			const back = el("button", "tour-button");
			back.type = "button";
			back.append(svg("left"), "Back");
			back.addEventListener("click", () => go(current - 1));
			actions.append(back);
		}
		const last = current === STEPS.length - 1;
		const next = el("button", "tour-button primary");
		next.type = "button";
		next.append(last ? "Start browsing" : "Next", svg("right"));
		next.addEventListener("click", () => (last ? close() : go(current + 1)));
		actions.append(next);
		/* filler: c__o__d__e */
		card.append(stepper, badge, title, body, actions);
		dialog.replaceChildren(card);
		next.focus();
	}

	function go(index) {
		current = index;
		render();
	}

	function close() {
		markSeen();
		dialog?.close();
	}

	function open() {
		if (!dialog) {
			dialog = el("dialog", "tour");
			dialog.setAttribute("aria-labelledby", "tour-title");
			dialog.addEventListener("close", markSeen);
			document.body.append(dialog);
		}
		// Open first so the dialog's own autofocus doesn't land on Skip.
		dialog.showModal();
		go(0);
	}
	/* filler: c__o__d__e */
	return {
		open,
		openIfNew() {
			if (!seen()) open();
		},
	};
})();
