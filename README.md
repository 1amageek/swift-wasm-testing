# swift-wasm-testing

Cross-package WASM browser-testing toolkit for the OpenCoreFoundation
Open\* family (`OpenCoreGraphics`, `OpenCoreAnimation`, `OpenCoreImage`,
`OpenImageIO`, `OpenSpriteKit`).

Extracts the scaffolding that each package previously carried by
copy-paste:

- Swift harness installer (`window.__<name>_test` helpers)
- `requestAnimationFrame` loop retainer
- WASI reactor-ABI boot glue (`@_cdecl("setup")` conventions)
- Swift Testing ABI v0 driver (`BrowserTestRunner.run()`)
- JavaScriptKit runtime (`runtime.mjs`)
- HTML / `app.js` / `server.mjs` / `build.sh` templates
- Playwright fixtures and type-safe harness proxy (TypeScript)
- `npx swift-wasm-testing run` TAP driver for CI

## Layout

```
swift-wasm-testing/
├── Package.swift                    Swift package manifest
├── package.json                     npm package manifest
├── Sources/WasmTesting/             Swift library
│   ├── WasmTesting.swift            @_exported re-exports
│   ├── Harness.swift                Harness.install(as:) builder
│   ├── RenderLoop.swift             RenderLoop.start { ... }
│   ├── ReactorBoot.swift            WasmTestingReactor.boot { ... }
│   └── BrowserTestRunner.swift      Swift Testing ABI v0 driver
├── ts/                              TypeScript side
│   ├── index.ts                     public entry
│   ├── fixtures.ts                  Playwright test.extend
│   ├── harness.ts                   buildHarness<T>(page, name)
│   └── lifecycle.ts                 waitForHarness / waitForReady
├── bin/swift-wasm-testing.mjs       CLI entry (shebang)
├── cli/                             CLI implementation
│   ├── run.mjs                        `run` subcommand
│   ├── server.mjs                     zero-dep static server
│   └── tap.mjs                        ABI v0 → TAP 14 formatter
├── assets/                          Static scaffolding
│   ├── runtime.mjs                  JavaScriptKit runtime (canonical copy)
│   └── templates/
│       ├── index.html.template
│       ├── app.js.template
│       ├── server.mjs.template
│       ├── build.sh.template
│       └── playwright.config.ts.template
├── validate/                        Internal validator (not shipped)
└── Tests/WasmTestingTests/          Native smoke tests
```

The Swift library and the TypeScript helpers ship from the **same Git
tag**, so consumers cannot drift between the two ecosystems.

## Swift usage

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/1amageek/swift-wasm-testing",
             from: "0.1.0"),
],
targets: [
    .executableTarget(
        name: "OSKSmoke",
        dependencies: [
            .product(name: "WasmTesting", package: "swift-wasm-testing"),
            // ...
        ]
    ),
]
```

```swift
// main.swift
import WasmTesting
import OpenSpriteKit

nonisolated(unsafe) var statusText = "initializing"
nonisolated(unsafe) var frameCount = 0
nonisolated(unsafe) var sceneRef: SKScene?
nonisolated(unsafe) var rendererRef: SKRenderer?

@_cdecl("setup")
public func setup() {
    WasmTestingReactor.boot(
        touchGlobals: {
            statusText = "initializing"
            frameCount = 0
            sceneRef = nil
            rendererRef = nil
        },
        then: { await performSetup() }
    )
}

@MainActor
func performSetup() async {
    Harness.install(as: "__osk_test") { h in
        h.expose("getStatus", returning: { .string(statusText) })
        h.expose("getFrameCount", returning: { .number(Double(frameCount)) })
        h.expose("spawnDynamic", action: spawnDynamic)
    }

    let renderer = SKRenderer(canvas: canvasObject)
    try? await renderer.initialize()
    let scene = SKScene(size: CGSize(width: 400, height: 300))
    renderer.scene = scene
    sceneRef = scene
    rendererRef = renderer

    RenderLoop.start { seconds in
        rendererRef?.update(atTime: seconds)
        rendererRef?.render()
        frameCount += 1
    }

    statusText = "ready"
}
```

## TypeScript usage

```ts
// tests/e2e/specs/boot.spec.ts
import { test, expect, type Harness } from "swift-wasm-testing";

interface OSK extends Harness {
    getStatus: () => string;
    getFrameCount: () => number;
    spawnDynamic: () => void;
    getSpawnAlpha: () => number;
}

test.use({ harnessGlobalName: "__osk_test" });

test("rAF advances frame count", async ({ harness }) => {
    const before = await (harness as unknown as OSK).getFrameCount();
    await new Promise(r => setTimeout(r, 500));
    const after = await (harness as unknown as OSK).getFrameCount();
    expect(after - before).toBeGreaterThanOrEqual(15);
});
```

### `file:` installs need `--install-links`

`swift-wasm-testing` is consumed via `"file:../../../swift-wasm-testing"`
in each package's `tests/e2e/package.json`. By default, npm resolves
`file:` deps as symlinks, and Node then resolves `@playwright/test`
from the *real* path — which yields an empty `node_modules` and the
"Cannot find package '@playwright/test'" error.

Install with `--install-links` so npm copies the package into the
consumer's `node_modules`. The consumer's Playwright install is then
resolved via the usual parent-directory lookup:

```bash
cd tests/e2e
npm install --install-links
```

## CLI: `npx swift-wasm-testing run`

Playwright-free TAP driver for CI. Takes a built `.wasm` and a web
directory, serves them on a free port, launches headless Chromium, polls
`window.__wasm_tests.done`, and prints TAP to stdout. Exits `0` when the
runner succeeds and no `@Test` function recorded an issue.

```bash
# from a package's Tests/e2e (where @playwright/test is installed)
npx swift-wasm-testing run \
    --wasm ../../Examples/SmokeTest/web/OSKSmoke.wasm \
    --web  ../../Examples/SmokeTest/web
```

Flags:

| Flag | Default | Notes |
|---|---|---|
| `--wasm <path>` | required | Built WASM module. Served at `/${basename}`. |
| `--web <dir>` | required | Must contain `index.html`, `app.js`, `runtime.mjs`. |
| `--port <n>` | `0` (auto) | Bind to a fixed port, e.g. for reverse-proxy scenarios. |
| `--timeout <ms>` | `60000` | Max wait for `__wasm_tests.done === true`. |
| `--headed` | off | Launch Chromium with a UI (for debugging). |
| `--keep-open` | off | Leave the browser + server running after completion. |

Output: TAP 14 on stdout. Page `console` / `pageerror` are mirrored to
stderr so CI logs stay readable. Exits `1` on test failure, runner
error, or timeout (`Bail out!`).

`@playwright/test` is a peer dependency — the CLI resolves `playwright`
from the consumer's `node_modules` (cwd) first, so typical usage is to
invoke it from a package's `Tests/e2e` directory after
`npm install --install-links`.

## Development

```bash
# Swift
swift build
swift test

# TypeScript
npm install
npm run typecheck
npm run build
```

## License

MIT.
