// swift-tools-version: 6.0
//
// swift-wasm-testing — cross-package WASM browser test harness.
//
// Provides the Swift-side building blocks (global `__xxx_test` harness
// installer, rAF loop retainer, reactor-ABI boot helper) that the Open*
// family of sibling packages shared by copy-paste before this library
// existed. The TypeScript counterpart lives at `ts/` in the same repo and
// is distributed through `package.json` (see root README for usage).

import PackageDescription

let package = Package(
    name: "swift-wasm-testing",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .library(
            name: "WasmTesting",
            targets: ["WasmTesting"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/swiftwasm/JavaScriptKit", from: "0.50.2"),
    ],
    targets: [
        .target(
            name: "WasmTesting",
            dependencies: [
                .product(name: "JavaScriptKit", package: "JavaScriptKit"),
                .product(name: "JavaScriptEventLoop", package: "JavaScriptKit"),
            ],
            swiftSettings: [
                .enableExperimentalFeature("Extern"),
            ]
        ),
        .executableTarget(
            name: "WasmTestingValidator",
            dependencies: ["WasmTesting"],
            path: "Sources/WasmTestingValidator",
            linkerSettings: [
                .unsafeFlags([
                    "-Xclang-linker", "-mexec-model=reactor",
                    "-Xlinker", "--export=setup",
                ])
            ]
        ),
        .testTarget(
            name: "WasmTestingTests",
            dependencies: ["WasmTesting"]
        ),
    ]
)
