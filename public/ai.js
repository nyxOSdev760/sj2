"use strict";

// Skyline AI chat drawer. It talks to the Node server's /api/ai/ (src/ai.js), which
// holds the Gemini key and enforces each visitor's daily limit.
self.SkylineAI = (() => {
	const endpoint = new URL(self.SJ2_CONFIG?.aiEndpoint || "api/ai/", new URL("./", location.href));
	// The browser-ID cookie that gives each browser its own limit has to be sent along,
	// including to an AI server on another site.
	const credentials = endpoint.origin === location.origin ? "same-origin" : "include";
	const SUGGESTIONS = ["Explain something simply", "Help me write a message", "Give me a study plan"];

	const $ = (id) => document.getElementById(id);
	let panel, log, form, input, quota;
	let messages = []; // {role: "user" | "model", text}
	let status = null; // {enabled, limit, remaining}
	let busy = false;
	let controller = null;

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text != null) node.textContent = text;
		return node;
	}

	// Inline `code` and **bold**, as DOM nodes (never HTML from the model).
	function inline(parent, text) {
		for (const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/)) {
			if (!part) continue;
			if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
				parent.append(el("code", null, part.slice(1, -1)));
			} else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
				parent.append(el("strong", null, part.slice(2, -2)));
			} else {
				parent.append(part);
			}
		}
	}

	// A small Markdown subset: ``` code blocks, # headings, - / 1. lists, paragraphs.
	function renderMarkdown(target, text) {
		target.replaceChildren();
		const pieces = text.split(/```[\w+-]*\n?([\s\S]*?)(?:```|$)/);
		pieces.forEach((piece, i) => {
			if (i % 2 === 1) {
				const pre = el("pre");
				pre.append(el("code", null, piece.replace(/\n$/, "")));
				target.append(pre);
				return;
			}
			for (const block of piece.split(/\n{2,}/)) {
				const lines = block.split("\n").filter((l) => l.trim());
				if (!lines.length) continue;
				if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
					const list = el(/^\s*\d/.test(lines[0]) ? "ol" : "ul");
					for (const line of lines) {
						const item = el("li");
						inline(item, line.replace(/^\s*([-*]|\d+\.)\s+/, ""));
						list.append(item);
					}
					target.append(list);
				} else if (lines.length === 1 && /^#{1,6}\s/.test(lines[0])) {
					const heading = el("p", "ai-heading");
					inline(heading, lines[0].replace(/^#+\s+/, ""));
					target.append(heading);
				} else {
					const p = el("p");
					lines.forEach((line, n) => {
						if (n) p.append(el("br"));
						inline(p, line.replace(/^#+\s+/, ""));
					});
					target.append(p);
				}
			}
		});
	}

	function bubble(role, text = "") {
		const node = el("div", `ai-msg ${role}`);
		const body = el("div", "ai-body");
		if (role === "model") renderMarkdown(body, text);
		else body.textContent = text;
		node.append(body);
		log.append(node);
		log.scrollTop = log.scrollHeight;
		return body;
	}

	function renderEmpty() {
		log.replaceChildren();
		const empty = el("div", "ai-empty");
		const title = el("p", "ai-empty-title", "Hey! Ask me anything.");
		empty.append(title);
		if (status && !status.enabled) {
			empty.append(el("p", null, "Skyline AI isn't available on this server."));
		} else {
			const chips = el("div", "ai-chips");
			for (const text of SUGGESTIONS) {
				const chip = el("button", "ai-chip", text);
				chip.type = "button";
				chip.addEventListener("click", () => {
					input.value = text;
					input.focus();
					autosize();
				});
				chips.append(chip);
			}
			empty.append(chips);
		}
		log.append(empty);
	}

	function renderQuota() {
		const enabled = !!status?.enabled;
		const left = status?.remaining ?? 0;
		quota.textContent = !status ? "" : enabled ? `${left}/${status.limit} left today` : "Off";
		quota.classList.toggle("empty", enabled && left <= 0);
		input.disabled = !enabled || left <= 0;
		input.placeholder = !enabled
			? "AI is off on this server"
			: left <= 0
				? "Daily limit reached. Come back tomorrow"
				: "Ask anything…";
		form.querySelector("button").disabled = input.disabled;
	}

	async function refreshStatus() {
		try {
			const res = await fetch(new URL("status", endpoint), { cache: "no-store", credentials });
			if (!res.ok) throw new Error(String(res.status));
			status = await res.json();
		} catch {
			status = { enabled: false };
		}
		renderQuota();
		if (!messages.length) renderEmpty();
	}

	function autosize() {
		input.style.height = "auto";
		input.style.height = Math.min(input.scrollHeight, 160) + "px";
	}

	async function send(text) {
		text = text.trim();
		if (!text || busy || input.disabled) return;
		if (!messages.length) log.replaceChildren();
		busy = true;
		messages.push({ role: "user", text });
		bubble("user", text);
		input.value = "";
		autosize();

		const body = bubble("model");
		body.parentElement.classList.add("pending");
		let reply = "";
		controller = new AbortController();
		try {
			const res = await fetch(new URL("chat", endpoint), {
				method: "POST",
				// text/plain keeps this a "simple" request for cross-site setups.
				headers: { "Content-Type": "text/plain;charset=UTF-8" },
				body: JSON.stringify({ messages }),
				signal: controller.signal,
				credentials,
			});
			const left = res.headers.get("X-AI-Remaining");
			if (left != null && status) status.remaining = Number(left);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				if (res.status === 429 && /used all/.test(data.error || "") && status) status.remaining = 0;
				throw new Error(data.error || "Something went wrong.");
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				reply += decoder.decode(value, { stream: true });
				body.parentElement.classList.remove("pending");
				renderMarkdown(body, reply);
				log.scrollTop = log.scrollHeight;
			}
			if (!reply.trim()) throw new Error("The AI didn't answer. Try again.");
			messages.push({ role: "model", text: reply });
		} catch (err) {
			body.parentElement.classList.remove("pending");
			if (err.name === "AbortError") {
				if (reply) messages.push({ role: "model", text: reply });
				else messages.pop();
			} else {
				messages.pop(); // let them resend it
				body.parentElement.classList.add("error");
				body.textContent = err.message;
			}
		} finally {
			busy = false;
			controller = null;
			renderQuota();
			if (!input.disabled) input.focus();
		}
	}

	function open() {
		panel.hidden = false;
		document.body.classList.add("ai-open");
		refreshStatus();
		input.focus();
	}

	function close() {
		panel.hidden = true;
		document.body.classList.remove("ai-open");
	}

	function init() {
		panel = $("ai-panel");
		log = $("ai-log");
		form = $("ai-form");
		input = $("ai-input");
		quota = $("ai-quota");

		form.addEventListener("submit", (e) => {
			e.preventDefault();
			send(input.value);
		});
		input.addEventListener("input", autosize);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				send(input.value);
			}
		});
		// Escape closes the drawer, unless a dialog (Settings, History…) is on top of it.
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && !panel.hidden && !document.querySelector("dialog[open]")) close();
		});
		$("ai-close").addEventListener("click", close);
		$("ai-new").addEventListener("click", () => {
			controller?.abort();
			messages = [];
			renderEmpty();
			input.focus();
		});
		renderEmpty();
	}

	return {
		init,
		open,
		close,
		toggle() {
			panel.hidden ? open() : close();
		},
	};
})();
