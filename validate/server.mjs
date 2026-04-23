// Minimal static server for validate/web/. Used only by the validator
// Playwright harness; not shipped to consumers.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WEB_ROOT = join(__dirname, "web");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".wasm": "application/wasm",
};

function resolvePhysical(urlPath) {
    const clean = normalize(decodeURIComponent(urlPath.split("?")[0]));
    const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
    const full = join(WEB_ROOT, rel);
    if (!full.startsWith(WEB_ROOT)) return null;
    return full;
}

async function serve(req, res) {
    const filePath = resolvePhysical(req.url);
    if (!filePath) { res.writeHead(403); res.end("Forbidden"); return; }
    try {
        const stats = await stat(filePath);
        if (!stats.isFile()) { res.writeHead(404); res.end("Not Found"); return; }
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
        if (err.code === "ENOENT") { res.writeHead(404); res.end(`Not Found: ${req.url}`); }
        else { res.writeHead(500); res.end(`Internal Error: ${err.message}`); }
    }
}

const PORT = Number(process.env.E2E_PORT ?? 8769);
createServer(serve).listen(PORT, "127.0.0.1", () => {
    console.log(`validator server listening on http://127.0.0.1:${PORT}`);
});
