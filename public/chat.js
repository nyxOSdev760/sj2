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
	let source = null;
	let me = null;
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

	function add(message) {
		log.querySelector(".chat-empty")?.remove();
		const stick = nearBottom();
		const item = el("div", "chat-msg");
		if (message.from === me) item.classList.add("mine");
		const head = el("div", "chat-meta");
		const who = el("span", "chat-name-tag", message.name);
		who.style.color = colorFor(message.name);
		const when = el(
			"time",
			"chat-time",
			new Date(message.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		);
		head.append(who, when);
		item.append(head, el("div", "chat-text", message.text)); // text only, never HTML
		log.append(item);
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
			log.replaceChildren();
			if (data.messages.length) data.messages.forEach(add);
			else showEmpty("No messages yet. Say hi!");
			unread = 0;
			onUnread(0);
			setOnline(data.online);
			log.scrollTop = log.scrollHeight;
		});
		source.addEventListener("message", (e) => add(JSON.parse(e.data)));
		source.addEventListener("online", (e) => setOnline(JSON.parse(e.data).online));
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

	async function send() {
		const text = input.value.trim();
		if (!text) return;
		error.textContent = "";
		try {
			const res = await fetch(new URL("send", endpoint), {
				method: "POST",
				headers: { "Content-Type": "text/plain;charset=UTF-8" },
				body: JSON.stringify({ name: store.get(NAME_KEY), text, token: store.get(TOKEN_KEY) }),
				credentials: crossSite ? "include" : "same-origin",
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || "Couldn't send that.");
			input.value = "";
			autosize();
		} catch (err) {
			error.textContent = err.message === "Failed to fetch" ? "You're offline." : err.message;
		}
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
		$("chat-close").addEventListener("click", close);
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && !panel.hidden && !document.querySelector("dialog[open]")) close();
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
