"use strict";

// Skyline Chat drawer: one live room for everyone on the server (src/chat.js). It connects
// the first time it's opened and stays connected, so unread messages can be counted.
self.SkylineChat = (() => {
	const endpoint = new URL(self.SJ2_CONFIG?.chatEndpoint || "api/chat/", new URL("./", location.href));
	const crossSite = endpoint.origin !== location.origin;
	const NAME_KEY = "sj2:chatName";
	const TOKEN_KEY = "sj2:aiToken"; // the same signed browser ID the AI uses

	const $ = (id) => document.getElementById(id);
	let panel, log, form, input, nameForm, nameInput, nameError, error, onlineEl;
	let adminForm, adminInput, adminError, adminBar, menu;
	let source = null;
	let me = null;
	let isAdmin = false;
	let history = []; // messages on screen, so they can be redrawn with admin controls
	let unread = 0;
	let onUnread = () => {};

	const store = {
		get(key) {
			try {
				return localStorage.getItem(key);
			} catch {
				return null;
			}
		},
		set(key, value) {
			try {
				localStorage.setItem(key, value);
			} catch {
				// storage unavailable
			}
		},
	};

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text != null) node.textContent = text;
		return node;
	}

	function colorFor(name) {
		let hue = 0;
		for (const ch of name) hue = (hue * 31 + ch.codePointAt(0)) % 360;
		return `hsl(${hue} 65% 55%)`;
	}

	function nearBottom() {
		return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
	}

	function render(message) {
		const item = el("div", "chat-msg");
		item.dataset.id = message.id;
		if (message.from === me) item.classList.add("mine");
		const head = el("div", "chat-meta");
		const who = el("span", "chat-name-tag", message.name);
		who.style.color = colorFor(message.name);
		head.append(who);
		if (message.admin) head.append(el("span", "chat-admin-badge", "Admin"));
		head.append(
			el("time", "chat-time", new Date(message.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))
		);
		if (isAdmin) {
			const more = el("button", "chat-more", "⋯");
			more.type = "button";
			more.title = "Admin actions";
			more.setAttribute("aria-label", "Admin actions");
			more.addEventListener("click", (e) => {
				e.stopPropagation();
				openMenu(more, message);
			});
			head.append(more);
		}
		item.append(head, el("div", "chat-text", message.text)); // text only, never HTML
		return item;
	}

	function redraw() {
		closeMenu();
		if (!history.length) return showEmpty("No messages yet. Say hi!");
		log.replaceChildren(...history.map(render));
	}

	function add(message) {
		log.querySelector(".chat-empty")?.remove();
		const stick = nearBottom();
		history.push(message);
		if (history.length > 200) history.shift();
		log.append(render(message));
		while (log.children.length > 200) log.firstElementChild.remove();
		if (stick || message.from === me) log.scrollTop = log.scrollHeight;
		if (panel.hidden && message.from !== me) {
			unread++;
			onUnread(unread);
		}
	}

	function showEmpty(text) {
		log.replaceChildren(el("p", "chat-empty", text));
	}

	function setOnline(count) {
		onlineEl.textContent = `${count} online`;
	}

	function connect() {
		if (source) return;
		const url = new URL("stream", endpoint);
		const token = store.get(TOKEN_KEY);
		if (token) url.searchParams.set("token", token);
		onlineEl.textContent = "Connecting…";
		source = new EventSource(url, { withCredentials: crossSite });
		source.addEventListener("hello", (e) => {
			const data = JSON.parse(e.data);
			me = data.you;
			if (data.token) store.set(TOKEN_KEY, data.token);
			setAdmin(Boolean(data.admin));
			history = data.messages.slice();
			redraw();
			unread = 0;
			onUnread(0);
			setOnline(data.online);
			log.scrollTop = log.scrollHeight;
		});
		source.addEventListener("message", (e) => add(JSON.parse(e.data)));
		source.addEventListener("online", (e) => setOnline(JSON.parse(e.data).online));
		source.addEventListener("delete", (e) => {
			const { id } = JSON.parse(e.data);
			history = history.filter((m) => m.id !== id);
			log.querySelector(`.chat-msg[data-id="${Number(id)}"]`)?.remove();
			if (!history.length) showEmpty("No messages yet. Say hi!");
		});
		source.addEventListener("clear", () => {
			history = [];
			showEmpty("The chat was cleared.");
		});
		source.onerror = () => {
			if (source.readyState === EventSource.CLOSED) {
				// The server answered with an error (no chat here) rather than dropping out.
				onlineEl.textContent = "Off";
				showEmpty("Chat isn't available on this server.");
				source = null;
			} else {
				onlineEl.textContent = "Reconnecting…";
			}
		};
	}

	function showNameForm(show) {
		nameForm.hidden = !show;
		form.hidden = show;
		if (show) {
			nameInput.value = store.get(NAME_KEY) || "";
			nameError.textContent = "";
			nameInput.focus();
		} else {
			input.focus();
		}
	}

	function autosize() {
		input.style.height = "auto";
		input.style.height = Math.min(input.scrollHeight, 140) + "px";
	}

	async function post(path, body) {
		const res = await fetch(new URL(path, endpoint), {
			method: "POST",
			headers: { "Content-Type": "text/plain;charset=UTF-8" },
			body: JSON.stringify({ ...body, token: store.get(TOKEN_KEY) }),
			credentials: crossSite ? "include" : "same-origin",
		}).catch(() => {
			throw new Error("You're offline.");
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || "Something went wrong.");
		return data;
	}

	async function send() {
		const text = input.value.trim();
		if (!text) return;
		error.textContent = "";
		// Hidden commands for the site's admins.
		if (text === "/admin") {
			input.value = "";
			return showAdminForm(true);
		}
		if (text === "/logout" && isAdmin) {
			input.value = "";
			return logout();
		}
		try {
			await post("send", { name: store.get(NAME_KEY), text });
			input.value = "";
			autosize();
		} catch (err) {
			error.textContent = err.message;
		}
	}

	// Admin controls.
	function setAdmin(value) {
		isAdmin = value;
		adminBar.hidden = !value;
		panel.classList.toggle("chat-is-admin", value);
	}

	function showAdminForm(show) {
		adminForm.hidden = !show;
		form.hidden = show;
		adminError.textContent = "";
		adminInput.value = "";
		(show ? adminInput : input).focus();
	}

	async function logout() {
		await post("admin/logout", {}).catch(() => {});
		setAdmin(false);
		redraw();
	}

	async function act(action, body, done) {
		error.textContent = "";
		try {
			await post(`admin/${action}`, body);
			if (done) done();
		} catch (err) {
			error.textContent = err.message;
		}
	}

	function closeMenu() {
		menu?.remove();
		menu = null;
	}

	function openMenu(anchor, message) {
		closeMenu();
		menu = el("div", "chat-menu");
		menu.setAttribute("role", "menu");
		const item = (label, run, danger) => {
			const button = el("button", danger ? "danger" : null, label);
			button.type = "button";
			button.setAttribute("role", "menuitem");
			button.addEventListener("click", () => {
				closeMenu();
				run();
			});
			menu.append(button);
		};
		item("Delete message", () => act("delete", { id: message.id }), true);
		if (message.from !== me) {
			const mute = (minutes, label) =>
				item(label, () =>
					act("mute", { from: message.from, minutes }, () => {
						error.textContent = minutes ? `${message.name} is muted.` : `${message.name} is unmuted.`;
					})
				);
			mute(10, "Mute 10 minutes");
			mute(60, "Mute 1 hour");
			mute(24 * 60, "Mute 1 day");
			mute(0, "Unmute");
		}
		anchor.closest(".chat-msg").append(menu);
		menu.querySelector("button").focus();
	}

	function open() {
		panel.hidden = false;
		connect();
		unread = 0;
		onUnread(0);
		showNameForm(!store.get(NAME_KEY));
		log.scrollTop = log.scrollHeight;
	}

	function close() {
		panel.hidden = true;
	}

	function init({ unreadChanged } = {}) {
		if (unreadChanged) onUnread = unreadChanged;
		panel = $("chat-panel");
		log = $("chat-log");
		form = $("chat-form");
		input = $("chat-input");
		nameForm = $("chat-name-form");
		nameInput = $("chat-name");
		nameError = $("chat-name-error");
		error = $("chat-error");
		onlineEl = $("chat-online");

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			send();
		});
		input.addEventListener("input", autosize);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				send();
			}
		});
		nameForm.addEventListener("submit", (e) => {
			e.preventDefault();
			const name = nameInput.value.trim().replace(/\s+/g, " ");
			if (!/^[\p{L}\p{N}_. -]{2,20}$/u.test(name)) {
				nameError.textContent = "Use 2–20 letters, numbers, spaces, dots or dashes.";
				return;
			}
			store.set(NAME_KEY, name);
			showNameForm(false);
		});
		$("chat-rename").addEventListener("click", () => showNameForm(true));

		adminForm = $("chat-admin-form");
		adminInput = $("chat-admin-password");
		adminError = $("chat-admin-error");
		adminBar = $("chat-admin-bar");
		adminForm.addEventListener("submit", async (e) => {
			e.preventDefault();
			adminError.textContent = "";
			try {
				await post("admin/login", { password: adminInput.value });
				setAdmin(true);
				showAdminForm(false);
				redraw();
			} catch (err) {
				adminError.textContent = err.message;
			}
		});
		$("chat-admin-cancel").addEventListener("click", () => showAdminForm(false));
		$("chat-admin-logout").addEventListener("click", logout);
		$("chat-clear").addEventListener("click", () => {
			if (confirm("Delete every message in the chat for everyone?")) act("clear", {});
		});
		document.addEventListener("click", (e) => {
			if (menu && !menu.contains(e.target)) closeMenu();
		});
		$("chat-close").addEventListener("click", close);
		document.addEventListener("keydown", (e) => {
			if (e.key !== "Escape" || panel.hidden || document.querySelector("dialog[open]")) return;
			if (menu) closeMenu();
			else close();
		});
		showEmpty("Connecting…");
	}

	return {
		init,
		open,
		close,
		get isOpen() {
			return !panel.hidden;
		},
	};
})();
