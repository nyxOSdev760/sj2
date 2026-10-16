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

	// Every one of `urls` that answers, fastest first.
	async function healthy(urls) {
		const results = await Promise.allSettled(
			urls.map(async (url) => {
				const started = performance.now();
				await probe(url);
				return { url, time: performance.now() - started };
			})
		);
		return results
			.filter((r) => r.status === "fulfilled")
			.sort((a, b) => a.value.time - b.value.time)
			.map((r) => r.value.url);
	}

	function label(url) {
		try {
			const u = new URL(url);
			return u.host + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
		} catch {
			return url;
		}
	}

	const RESCUE_COOLDOWN = 60 * 1000;

	// Sits in front of the real transport and swaps it out when its Wisp server dies.
	// `connectTo(url)` builds a fresh transport for a server URL; `pick(exclude)` returns
	// the URL to switch to.
	//
	// It also rescues single sites: when a site fails but the server is fine (the server
	// refuses that site, or the TLS handshake fails with it), the request is retried
	// through `alternatives()` (other TLS engines / servers), and the route that worked is
	// remembered for that site.
	class FailoverTransport {
		constructor({ url, transport, connectTo, pick, onSwitch, alternatives }) {
			this.url = url;
			this.inner = transport;
			this.connectTo = connectTo;
			this.pick = pick;
			this.onSwitch = onSwitch;
			this.alternatives = alternatives || (() => []);
			this.dead = new Set();
			this.checking = null;
			this.routes = new Map(); // hostname -> transport that works for it
			this.hopeless = new Map(); // hostname -> time rescue may be tried again
		}

		// Tries `run(transport)` on each alternative; remembers the first that works.
		async rescue(host, run) {
			if (this.hopeless.get(host) > Date.now()) return null;
			for (const alt of await this.alternatives()) {
				if (alt === this.inner) continue;
				try {
					if (!alt.ready) await alt.init();
					const result = await run(alt);
					this.routes.set(host, alt);
					return { result };
				} catch {
					// try the next one
				}
			}
			this.hopeless.set(host, Date.now() + RESCUE_COOLDOWN);
			return null;
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
			const host = remote.hostname;
			const route = this.routes.get(host);
			const send = (transport) => transport.request(remote, method, body, headers, signal);
			const first = route || this.inner;
			try {
				return await send(first);
			} catch (err) {
				if (signal?.aborted) throw err;
				// Only bodiless requests (page loads, images, scripts) are safe to send again.
				if (body != null) throw err;
				if (route) {
					this.routes.delete(host);
				} else {
					const switched = first === this.inner ? await this.checkServer() : true;
					if (switched) {
						try {
							return await send(this.inner);
						} catch {
							// fall through to the site rescue
						}
					}
				}
				const rescued = await this.rescue(host, send);
				if (rescued) return rescued.result;
				throw err;
			}
		}

		// WebSockets: use the site's known route; if it fails before opening, try the
		// alternatives before reporting the error.
		connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
			const host = url.hostname;
			let current = null;
			let closed = null;
			let opened = false;

			const attempt = (transport, next) => {
				current = transport.connect(
					url,
					protocols,
					requestHeaders,
					(...args) => {
						opened = true;
						if (transport !== this.inner) this.routes.set(host, transport);
						onopen(...args);
					},
					onmessage,
					onclose,
					(error) => {
						if (opened || closed) return onerror(error);
						if (transport === this.inner) this.checkServer();
						else if (this.routes.get(host) === transport) this.routes.delete(host);
						next ? next(error) : onerror(error);
					}
				);
				if (closed) current[1](...closed);
			};

			const tryAlternatives = async (error) => {
				if (this.hopeless.get(host) > Date.now()) return onerror(error);
				const list = (await this.alternatives()).filter((t) => t !== this.inner);
				const step = (i) => async (lastError) => {
					if (i >= list.length || closed) {
						if (!closed) this.hopeless.set(host, Date.now() + RESCUE_COOLDOWN);
						return onerror(lastError);
					}
					try {
						if (!list[i].ready) await list[i].init();
						attempt(list[i], step(i + 1));
					} catch {
						step(i + 1)(lastError);
					}
				};
				step(0)(error);
			};

			attempt(this.routes.get(host) || this.inner, tryAlternatives);
			return [
				(data) => current?.[0](data),
				(code, reason) => {
					closed = [code, reason];
					current?.[1](code, reason);
				},
			];
		}
	}

	return { expand, expandAll, probe, fastest, healthy, label, FailoverTransport };
})();
