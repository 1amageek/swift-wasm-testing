// lifecycle.ts — wait helpers for the Swift-side harness.
//
// Every Open* smoke test historically repeated these two helpers verbatim.
// They are extracted here so a change in boot semantics (e.g. a different
// "ready" sentinel) flows through all consumers via `npm update`.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Block until `window[globalName]` has been installed by the Swift side.
 *
 * @param page        Playwright page under test.
 * @param globalName  Harness global, e.g. `"__osk_test"`. Must match the
 *                    name passed to `Harness.install(as:)` in Swift.
 * @param timeoutMs   Max time to wait. Defaults to 10 s.
 */
export async function waitForHarness(
    page: Page,
    globalName: string,
    timeoutMs: number = 10_000,
): Promise<void> {
    await page.waitForFunction(
        (name) => !!(window as unknown as Record<string, unknown>)[name],
        globalName,
        { timeout: timeoutMs },
    );
}

/**
 * Block until the harness reports `getStatus() === "ready"`. Assumes the
 * Swift-side harness exposes a `getStatus` member returning a string
 * (convention across all Open* smoke tests).
 *
 * @param page        Playwright page under test.
 * @param globalName  Harness global, e.g. `"__osk_test"`.
 * @param timeoutMs   Max time to wait. Defaults to 30 s.
 */
export async function waitForReady(
    page: Page,
    globalName: string,
    timeoutMs: number = 30_000,
): Promise<void> {
    await expect
        .poll(
            async () =>
                await page.evaluate((name) => {
                    const h = (window as unknown as Record<
                        string,
                        { getStatus: () => string }
                    >)[name];
                    return h.getStatus();
                }, globalName),
            { timeout: timeoutMs },
        )
        .toBe("ready");
}
