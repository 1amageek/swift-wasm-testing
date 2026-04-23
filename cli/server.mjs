// Static HTTP server used by the `swift-wasm-testing run` CLI.
//
// Serves a consumer-provided web directory (containing index.html, app.js,
// runtime.mjs) and the freshly built .wasm file. Emits the CORP/COEP
// headers that `WebAssembly.instantiate` requires in Chromium under
// isolated origins.
//
// The server is intentionally tiny and dependency-free — it matches the
// shape of the `server.mjs.template` that each package ships, but is
// parameterised so the CLI can drive it from any consumer directory.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join, normalize, resolve } from "node:path";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".wasm": "application/wasm",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".map": "application/json; charset=utf-8",
};

function resolvePhysical(urlPath, webRoot) {
    const clean = normalize(decodeURIComponent(urlPath.split("?")[0]));
    const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
    const full = join(webRoot, rel);
    if (!full.startsWith(webRoot)) return null;
    return full;
}

/**
 * Start a static server bound to 127.0.0.1.
 *
 * @param {object} options
 * @param {string} options.webRoot  Absolute path to the directory served as `/`.
 * @param {string} [options.wasmPath]  Absolute path to a .wasm to serve at
 *                                     `/${basename(wasmPath)}`. If the web
 *                                     root already contains the file, the
 *                                     explicit mapping wins.
 * @param {number} [options.port]   Port to bind. 0 picks a free port.
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export async function startServer({ webRoot, wasmPath, port = 0 }) {
    const absWebRoot = resolve(webRoot);
    const wasmName = wasmPath ? basename(wasmPath) : null;
    const absWasmPath = wasmPath ? resolve(wasmPath) : null;

    const handler = async (req, res) => {
        try {
            if (wasmName && req.url && req.url.replace(/^\/+/, "").split("?")[0] === wasmName) {
                const data = await readFile(absWasmPath);
                res.writeHead(200, {
                    "Content-Type": "application/wasm",
                    "Content-Length": data.length,
                    "Cross-Origin-Opener-Policy": "same-origin",
                    "Cross-Origin-Embedder-Policy": "require-corp",
                });
                res.end(data);
                return;
            }
            const filePath = resolvePhysical(req.url, absWebRoot);
            if (!filePath) {
                res.writeHead(403); res.end("Forbidden"); return;
            }
            const stats = await stat(filePath);
            if (!stats.isFile()) {
                res.writeHead(404); res.end("Not Found"); return;
            }
            const data = await readFile(filePath);
            const mime = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
            res.writeHead(200, {
                "Content-Type": mime,
                "Content-Length": data.length,
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp",
            });
            res.end(data);
        } catch (err) {
            if (err.code === "ENOENT") {
                res.writeHead(404); res.end(`Not Found: ${req.url}`);
            } else {
                res.writeHead(500); res.end(`Internal Error: ${err.message}`);
            }
        }
    };

    const server = createServer(handler);
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
    });
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;

    return {
        url: `http://127.0.0.1:${boundPort}`,
        port: boundPort,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
