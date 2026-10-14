import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { mounts } from "./mounts.js";

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || "0.0.0.0";

logging.set_level(logging.INFO);
// Keep proxied traffic off the host's own network (no SSRF into localhost/LAN).
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;

// Resolve hostnames with AdGuard DNS, which answers 0.0.0.0 for ad and tracker domains;
// the loopback filter above then refuses those connections. DNS_SERVERS="" uses the
// system resolver instead.
const dnsServers = (process.env.DNS_SERVERS ?? "94.140.14.14,94.140.15.15")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
if (dnsServers.length) {
	wisp.options.dns_method = "resolve";
	wisp.options.dns_servers = dnsServers;
	wisp.options.dns_result_order = "ipv4first";
}

const mimeTypes = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".wasm": "application/wasm",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
};

async function resolveFile(pathname) {
	for (const [prefix, dir] of mounts) {
		if (!pathname.startsWith(prefix)) continue;
		let file = resolve(dir, "." + sep + pathname.slice(prefix.length));
		if (file !== dir && !file.startsWith(dir + sep)) return null;
		try {
			let info = await stat(file);
			if (info.isDirectory()) {
				file = join(file, "index.html");
				info = await stat(file);
			}
			return info.isFile() ? { file, size: info.size } : null;
		} catch {
			return null;
		}
	}
	return null;
}

function send(res, status, body) {
	res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	res.end(body);
}

const server = createServer(async (req, res) => {
	if (req.method !== "GET" && req.method !== "HEAD") {
		return send(res, 405, "Method Not Allowed");
	}

	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
	} catch {
		return send(res, 400, "Bad Request");
	}

	const found = await resolveFile(pathname);
	if (!found) {
		const notFound = await resolveFile("/404.html");
		res.writeHead(404, { "Content-Type": mimeTypes[".html"] });
		return req.method === "HEAD" || !notFound
			? res.end()
			: createReadStream(notFound.file).pipe(res);
	}

	res.writeHead(200, {
		"Content-Type":
			mimeTypes[extname(found.file).toLowerCase()] || "application/octet-stream",
		"Content-Length": found.size,
		"Cache-Control": "no-cache",
		"X-Content-Type-Options": "nosniff",
	});
	if (req.method === "HEAD") return res.end();
	createReadStream(found.file).pipe(res);
});

server.on("upgrade", (req, socket, head) => {
	if (req.url.startsWith("/wisp/")) {
		wisp.routeRequest(req, socket, head);
	} else {
		socket.end();
	}
});

server.listen(port, host, () => {
	console.log(`Saints listening on http://localhost:${port}`);
	console.log(`DNS: ${dnsServers.length ? dnsServers.join(", ") : "system resolver"}`);
});

function shutdown() {
	console.log("Shutting down");
	server.close();
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
