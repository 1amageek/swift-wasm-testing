// Stand-alone validator: boot WasmTestingValidator.wasm in headless
// Chromium, poll __wasm_tests.done, print records + summary. Exits 0 on
// runner success, 1 otherwise. Used only during development of
// swift-wasm-testing itself.

import { chromium } from "playwright";

const URL = process.env.VALIDATOR_URL ?? "http://127.0.0.1:8769/";
const TIMEOUT_MS = Number(process.env.VALIDATOR_TIMEOUT_MS ?? 30_000);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (msg) => console.log(`[page:${msg.type()}]`, msg.text()));
page.on("pageerror", (err) => console.error("[pageerror]", err.message));

await page.goto(URL);

const result = await page.waitForFunction(
    () => window.__wasm_tests && window.__wasm_tests.done === true,
    null,
    { timeout: TIMEOUT_MS }
).then(() => page.evaluate(() => ({
    success: window.__wasm_tests.success,
    error: window.__wasm_tests.error,
    records: window.__wasm_tests.records,
})));

console.log("----- records -----");
for (const raw of result.records) {
    try {
        const rec = JSON.parse(raw);
        console.log(JSON.stringify(rec));
    } catch {
        console.log("[unparsable]", raw);
    }
}
console.log("-------------------");
console.log(`done: success=${result.success} error=${result.error ?? "null"} records=${result.records.length}`);

await browser.close();
process.exit(result.success ? 0 : 1);
