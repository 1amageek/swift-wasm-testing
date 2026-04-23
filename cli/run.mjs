// `swift-wasm-testing run` — boot a WASM smoke in headless Chromium and
// emit TAP from the Swift Testing ABI v0 record stream.
//
// Flow:
//   1. Parse --wasm / --web / --port / --timeout / --headed.
//   2. Start a static server bound to 127.0.0.1.
//   3. Launch Playwright Chromium (headless unless --headed).
//   4. Navigate to `/`, wait for `window.__wasm_tests.done === true`.
//   5. Read the records, format TAP, print to stdout.
//   6. Exit 0 on success, 1 on failure / timeout / runner error.
//
// This is the Playwright-free equivalent of `validate/run.mjs` — suitable
// for CI that wants TAP output without wiring up `playwright test` +
// fixtures per package.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startServer } from "./server.mjs";
import { formatTAP } from "./tap.mjs";

const USAGE = `\
usage: swift-wasm-testing run --wasm <path> --web <dir> [options]

Required:
  --wasm <path>      Path to the built .wasm module.
  --web <dir>        Directory containing index.html / app.js / runtime.mjs.

Options:
  --port <n>         Port to bind (default: 0, picks a free port).
  --timeout <ms>     Max wait for __wasm_tests.done (default: 60000).
  --headed           Run Chromium headed (for debugging).
  --keep-open        Keep the browser open after completion (implies --headed).
  -h, --help         Show this help.
`;

function parseArgs(argv) {
    const opts = {
        wasm: null,
        web: null,
        port: 0,
        timeoutMs: 60_000,
        headed: false,
        keepOpen: false,
    };
    const args = [...argv];
    while (args.length > 0) {
        const a = args.shift();
        switch (a) {
            case "--wasm": opts.wasm = args.shift(); break;
            case "--web": opts.web = args.shift(); break;
            case "--port": opts.port = Number(args.shift()); break;
            case "--timeout": opts.timeoutMs = Number(args.shift()); break;
            case "--headed": opts.headed = true; break;
            case "--keep-open": opts.keepOpen = true; opts.headed = true; break;
            case "-h":
            case "--help":
                process.stdout.write(USAGE);
                process.exit(0);
            default:
                throw new Error(`unknown argument: ${a}`);
        }
    }
    if (!opts.wasm || !opts.web) {
        process.stderr.write(USAGE);
        throw new Error("--wasm and --web are required");
    }
    return opts;
}

// Resolve playwright from the consumer's cwd (not from this package),
// since swift-wasm-testing declares @playwright/test as a peer dep that
// the consumer installs. We try cwd first, then fall back to this
// package's own resolution.
async function loadChromium() {
    const tried = [];
    const tryResolve = async (specifier, requireFn) => {
        try {
            const resolved = requireFn.resolve(specifier);
            const mod = await import(pathToFileURL(resolved).href);
            const chromium = mod.chromium ?? mod.default?.chromium;
            if (chromium) return chromium;
            tried.push(`${specifier} (loaded but no chromium export)`);
            return null;
        } catch (err) {
            tried.push(`${specifier} (${err.code ?? err.message})`);
            return null;
        }
    };

    const cwdRequire = createRequire(pathToFileURL(join(process.cwd(), "noop.js")).href);
    const selfRequire = createRequire(import.meta.url);

    for (const req of [cwdRequire, selfRequire]) {
        for (const spec of ["playwright", "@playwright/test"]) {
            const chromium = await tryResolve(spec, req);
            if (chromium) return chromium;
        }
    }

    throw new Error(
        "playwright is not installed. Install @playwright/test as a peer dependency " +
        "in your project (cwd=" + process.cwd() + "): " +
        "`npm install --save-dev @playwright/test && npx playwright install chromium`. " +
        "Tried: " + tried.join(", ")
    );
}

export async function runCommand(argv) {
    const opts = parseArgs(argv);

    const absWasm = resolve(opts.wasm);
    const absWeb = resolve(opts.web);
    if (!existsSync(absWasm)) {
        throw new Error(`wasm file does not exist: ${absWasm}`);
    }
    if (!existsSync(absWeb)) {
        throw new Error(`web directory does not exist: ${absWeb}`);
    }

    const server = await startServer({
        webRoot: absWeb,
        wasmPath: absWasm,
        port: Number.isFinite(opts.port) ? opts.port : 0,
    });

    const chromium = await loadChromium();
    const browser = await chromium.launch({
        headless: !opts.headed,
        args: [
            "--enable-unsafe-webgpu",
            "--enable-webgpu-developer-features",
        ],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleLines = [];
    page.on("console", (msg) => {
        const line = `[page:${msg.type()}] ${msg.text()}`;
        consoleLines.push(line);
        process.stderr.write(line + "\n");
    });
    page.on("pageerror", (err) => {
        const line = `[pageerror] ${err.message}`;
        consoleLines.push(line);
        process.stderr.write(line + "\n");
    });

    let exitCode = 1;
    let result = null;
    try {
        await page.goto(server.url + "/");
        await page.waitForFunction(
            () => {
                const t = /** @type {any} */ (window).__wasm_tests;
                return !!t && t.done === true;
            },
            null,
            { timeout: opts.timeoutMs }
        );
        result = await page.evaluate(() => {
            const t = /** @type {any} */ (window).__wasm_tests;
            return {
                success: !!t.success,
                error: t.error ?? null,
                records: Array.isArray(t.records) ? t.records.slice() : [],
            };
        });

        const tap = formatTAP(result.records, {
            success: result.success,
            error: result.error,
        });
        process.stdout.write(tap.tap);
        exitCode = tap.success ? 0 : 1;
    } catch (err) {
        process.stderr.write(`[swift-wasm-testing] ${err.message ?? err}\n`);
        process.stdout.write("TAP version 14\nBail out! " + (err.message ?? String(err)) + "\n");
        exitCode = 1;
    } finally {
        if (!opts.keepOpen) {
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
            await server.close().catch(() => {});
        } else {
            process.stderr.write(`[swift-wasm-testing] --keep-open set; leaving browser + server running on ${server.url}\n`);
        }
    }

    return exitCode;
}
