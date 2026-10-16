"use strict";

// Wisp server fallback. The site carries a list of Wisp servers (config.js); on start
// every one is probed in parallel and the fastest real Wisp server is used. If that
// server stops responding later, the next fastest takes over without a reload.
self.WispPool = (() => {
	const PROBE_TIMEOUT = 6000;
	const HEALTH_TIMEOUT = 4000;

	// "host" or "host/path" or "wss://host/path" -> candidate URLs. A bare host is tried
	// at both /wisp/ (the usual path) and / since servers differ.
	function expand(entry) {
		entry = entry.trim();
		if (!entry) return [];
		if (entry === "self") {
			const local = new URL("wisp/", new URL("./", location.href));
			local.protocol = location.protocol === "https:" ? "wss:" : "ws:";
			return [local.href];
		}
		if (/^wss?:\/\//i.test(entry)) return [new URL(entry).href];
		const url = new URL("wss://" + entry);
		if (url.pathname !== "/") return [url.href];
		return [`wss://${url.host}/wisp/`, `wss://${url.host}/`];
	}

	function expandAll(entries) {
		return [...new Set(entries.flatMap(expand))];
	}

	// Resolves with `url` once it answers like a Wisp server: right after the socket opens
	// the server sends a CONTINUE (0x03, Wisp v1) or INFO (0x05, Wisp v2) packet.
	function probe(url, timeout = PROBE_TIMEOUT) {
		return new Promise((resolve, reject) => {
			let socket;
			const done = (ok, reason) => {
				clearTimeout(timer);
				try {
					socket.close();
				} catch {
					// already closed
				}
				ok ? resolve(url) : reject(new Error(`${url}: ${reason}`));
			};
			const timer = setTimeout(() => done(false, "timed out"), timeout);
			try {
				socket = new WebSocket(url);
			} catch (err) {
				return done(false, err.message);
			}
			socket.binaryType = "arraybuffer";
			socket.onmessage = ({ data }) => {
				const type = data instanceof ArrayBuffer && data.byteLength ? new Uint8Array(data)[0] : -1;
				done(type === 0x03 || type === 0x05, "not a Wisp server");
			};
			socket.onerror = () => done(false, "connection failed");
			socket.onclose = () => done(false, "closed");
		});
	}

	// The first of `urls` to answer wins. Throws if none do.
	async function fastest(urls) {
		if (!urls.length) throw new Error("No Wisp servers configured");
		try {
			return await Promise.any(urls.map((url) => probe(url)));
		} catch {
			throw new Error("None of the Wisp servers responded");
		}
	}

	function label(url) {
		try {
			const u = new URL(url);
			return u.host + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
		} catch {
			return url;
		}
	}

	// Sits in front of the real transport and swaps it out when its Wisp server dies.
	// `connectTo(url)` builds a fresh transport for a server URL; `pick(exclude)` returns
	// the URL to switch to.
	class FailoverTransport {
		constructor({ url, transport, connectTo, pick, onSwitch }) {
			this.url = url;
			this.inner = transport;
			this.connectTo = connectTo;
			this.pick = pick;
			this.onSwitch = onSwitch;
			this.dead = new Set();
			this.checking = null;
		}

		get ready() {
			return this.inner.ready;
		}

		init() {
			return this.inner.init();
		}

		use(url, transport) {
			this.url = url;
			this.inner = transport;
		}

		// After a failed request: if the current server no longer answers, move to another.
		// Resolves true when the transport was replaced.
		checkServer() {
			this.checking ??= (async () => {
				const url = this.url;
				try {
					await probe(url, HEALTH_TIMEOUT);
					return false; // server is fine; the site itself failed
				} catch {
					this.dead.add(url);
				}
				const next = await this.pick(this.dead);
				if (!next || next === url) return false;
				this.use(next, await this.connectTo(next));
				this.onSwitch?.(url, next);
				return true;
			})()
				.catch((err) => {
					console.warn("Wisp failover failed:", err);
					return false;
				})
				.finally(() => {
					this.checking = null;
				});
			return this.checking;
		}

		async request(remote, method, body, headers, signal) {
			const inner = this.inner;
			try {
				return await inner.request(remote, method, body, headers, signal);
			} catch (err) {
				if (signal?.aborted) throw err;
				const switched = inner === this.inner ? await this.checkServer() : true;
				// Bodiless requests (page loads, images, scripts) are safe to send again.
				if (switched && body == null) {
					return this.inner.request(remote, method, body, headers, signal);
				}
				throw err;
			}
		}

		connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
			let opened = false;
			return this.inner.connect(
				url,
				protocols,
				requestHeaders,
				(...args) => {
					opened = true;
					onopen(...args);
				},
				onmessage,
				onclose,
				(error) => {
					if (!opened) this.checkServer();
					onerror(error);
				}
			);
		}
	}

	return { expand, expandAll, probe, fastest, label, FailoverTransport };
})();
