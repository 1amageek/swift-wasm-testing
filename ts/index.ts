// swift-wasm-testing — TypeScript entry point.
//
// Consumers (each package's tests/e2e/) should:
//
//   import { test, expect, buildHarness } from "swift-wasm-testing";
//
// and use `test` (a Playwright `test` re-export extended with a typed
// `harness` fixture) together with `buildHarness<T>()` to access the
// Swift-side `window.__<name>_test` object in a type-checked way.

export { test, expect, type HarnessFixture } from "./fixtures.js";
export { buildHarness, type Harness, type HarnessMethod } from "./harness.js";
export { waitForHarness, waitForReady } from "./lifecycle.js";
