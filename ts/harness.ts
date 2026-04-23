// harness.ts — type-safe proxy for `window.__<name>_test`.
//
// The Swift side installs arbitrary members on a global JS object. In tests
// we want to call them as if they were local TS functions, with return
// types fed back into Playwright's `expect.poll` and friends.
//
// Instead of writing:
//
//     await page.evaluate(() => (window as any).__osk_test.getSpawnAlpha());
//
// for every call, `buildHarness<T>(page, "__osk_test")` returns a Proxy<T>
// whose member accesses transparently become `page.evaluate` round-trips.

import type { Page } from "@playwright/test";

/** Any function reachable through the harness. */
export type HarnessMethod = (...args: never[]) => unknown;

/** Constraint: every harness member must be callable. */
export type Harness = Record<string, HarnessMethod>;

/**
 * Build a typed proxy over a Swift-side harness installed at
 * `window[globalName]`. Each property access returns an async function
 * that round-trips through `page.evaluate`.
 *
 * @example
 *   interface OSK extends Harness {
 *       getStatus: () => string;
 *       spawnDynamic: () => void;
 *       getSpawnAlpha: () => number;
 *   }
 *   const h = buildHarness<OSK>(page, "__osk_test");
 *   await h.spawnDynamic();
 *   const alpha = await h.getSpawnAlpha();
 */
export function buildHarness<T extends Harness>(
    page: Page,
    globalName: string,
): {
    [K in keyof T]: (
        ...args: Parameters<T[K]>
    ) => Promise<Awaited<ReturnType<T[K]>>>;
} {
    const target = {} as Record<string, unknown>;
    const handler: ProxyHandler<Record<string, unknown>> = {
        get(_t, prop) {
            if (typeof prop !== "string") return undefined;
            return async (...args: unknown[]) =>
                await page.evaluate(
                    ({ name, method, argv }) => {
                        const h = (window as unknown as Record<
                            string,
                            Record<string, (...a: unknown[]) => unknown>
                        >)[name];
                        return h[method](...argv);
                    },
                    { name: globalName, method: prop, argv: args },
                );
        },
    };
    return new Proxy(target, handler) as {
        [K in keyof T]: (
            ...args: Parameters<T[K]>
        ) => Promise<Awaited<ReturnType<T[K]>>>;
    };
}
