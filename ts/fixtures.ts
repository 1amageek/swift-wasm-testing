// fixtures.ts — Playwright `test` extension with a typed `harness` fixture.
//
// Consumers configure the fixture by setting the `harnessGlobalName` option
// (via `test.use`) and by parameterising the generic with their
// harness's shape:
//
//     import { test as base, type Harness } from "swift-wasm-testing";
//
//     interface OSK extends Harness {
//         getStatus: () => string;
//         spawnDynamic: () => void;
//     }
//
//     const test = base<OSK>;     // equivalent to re-exporting with T bound
//
//     test.use({ harnessGlobalName: "__osk_test" });
//
//     test("spawn dynamic", async ({ harness, waitReady }) => {
//         await waitReady();
//         await harness.spawnDynamic();
//     });

import { test as baseTest, expect } from "@playwright/test";
import { buildHarness, type Harness } from "./harness.js";
import { waitForHarness, waitForReady } from "./lifecycle.js";

export interface HarnessFixture<T extends Harness> {
    /** Global JS name the Swift harness was installed under. */
    harnessGlobalName: string;
    /** Typed proxy over `window[harnessGlobalName]`. */
    harness: {
        [K in keyof T]: (
            ...args: Parameters<T[K]>
        ) => Promise<Awaited<ReturnType<T[K]>>>;
    };
    /** Wait until the harness global appears on `window`. */
    waitHarness: () => Promise<void>;
    /** Wait until `harness.getStatus()` returns `"ready"`. */
    waitReady: () => Promise<void>;
}

/**
 * Playwright `test` extended with a typed harness fixture. The fixture
 * automatically navigates to `/`, waits for the harness to appear, and
 * waits for `getStatus() === "ready"` before the test body runs.
 */
export const test = baseTest.extend<HarnessFixture<Harness>>({
    harnessGlobalName: [
        "__wasm_test",
        { option: true },
    ],
    harness: async ({ page, harnessGlobalName }, use) => {
        await page.goto("/");
        await waitForHarness(page, harnessGlobalName);
        await waitForReady(page, harnessGlobalName);
        await use(buildHarness<Harness>(page, harnessGlobalName));
    },
    waitHarness: async ({ page, harnessGlobalName }, use) => {
        await use(() => waitForHarness(page, harnessGlobalName));
    },
    waitReady: async ({ page, harnessGlobalName }, use) => {
        await use(() => waitForReady(page, harnessGlobalName));
    },
});

export { expect };
