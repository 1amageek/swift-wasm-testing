// BrowserTestRunner — drives Swift Testing's ABI v0 entry point from a
// WASI reactor-ABI module and streams each JSON record to a JS-side
// container at `window.__wasm_tests`.
//
// The Swift Testing ABI v0 entry point is the stable public contract for
// tools (swift-testing/Documentation/ABI/JSON.md). We obtain it via the
// `swt_abiv0_getEntryPoint` C export and bitcast to the documented
// function pointer type, which keeps the integration source-stable across
// Swift Testing releases that may not export `ABI.v0.entryPoint` directly
// from `@_spi(ForToolsIntegrationOnly) import Testing` in every toolchain.
//
// Flow:
//   1. Install the JavaScriptKit global executor so async hops work.
//   2. Prime `window.__wasm_tests = { records: [], done, success }`.
//   3. Spawn a Task that invokes the entry point. Each UTF-8 JSON record
//      pushed by the test runner is forwarded into the JS `records` array.
//   4. When the entry point returns, flip `done = true` and `success` to
//      the runner's bool result. The Node-side driver polls these from
//      Playwright and formats the stream.
//
// Usage (from the consumer's @_cdecl("setup")):
//
//     @_cdecl("setup")
//     public func setup() {
//         BrowserTestRunner.start()
//     }
//
// The module must `import Testing` somewhere (typically in the same
// executable target, alongside its `@Test` functions) so that the
// `__swift5_tests` section is populated and the runner can discover them.

import Foundation

#if arch(wasm32)

@_extern(c, "swt_abiv0_getEntryPoint")
func swt_abiv0_getEntryPoint() -> UnsafeRawPointer

public enum BrowserTestRunner {
    public typealias ABIEntryPoint = @convention(thin) @Sendable (
        _ configurationJSON: UnsafeRawBufferPointer?,
        _ recordHandler: @escaping @Sendable (_ recordJSON: UnsafeRawBufferPointer) -> Void
    ) async throws -> Bool

    /// Install the JavaScriptKit executor, prime the result container,
    /// and spawn the runner task. Intended to be called synchronously
    /// from a bare `@_cdecl("setup")` that has no other async work.
    ///
    /// Consumers that need to perform async setup (e.g., WebGPU device
    /// initialisation) before tests start should use `run(...)` from
    /// inside their own async context after the executor is installed.
    public static func start(
        configurationJSON: String = #"{"verbosity":0}"#
    ) {
        JavaScriptEventLoop.installGlobalExecutor()
        run(configurationJSON: configurationJSON)
    }

    /// Prime `window.__wasm_tests` and spawn the runner task. Assumes
    /// the JavaScriptKit event-loop executor is already installed (e.g.
    /// via `WasmTestingReactor.boot`). Returns immediately; completion
    /// is signalled via `window.__wasm_tests.done`.
    public static func run(
        configurationJSON: String = #"{"verbosity":0}"#
    ) {
        let container = JSObject.global.Object.function!.new()
        container.records = .object(JSObject.global.Array.function!.new())
        container.done = .boolean(false)
        container.success = .boolean(false)
        container.error = .null
        JSObject.global.__wasm_tests = .object(container)

        Task { await runAll(configurationJSON: configurationJSON) }
    }

    @Sendable
    private static func runAll(configurationJSON: String) async {
        let entryPoint = unsafeBitCast(
            swt_abiv0_getEntryPoint(),
            to: ABIEntryPoint.self
        )

        let recordHandler: @Sendable (UnsafeRawBufferPointer) -> Void = { buf in
            guard let base = buf.baseAddress else { return }
            let data = Data(bytes: base, count: buf.count)
            guard let json = String(data: data, encoding: .utf8) else { return }
            pushRecord(json)
        }

        // Copy the configuration bytes into a long-lived allocation so the
        // pointer passed to `entryPoint` remains valid across the async
        // suspension. `withUnsafeBytes` does not support async closures.
        let configBytes = Array(configurationJSON.utf8)
        let count = configBytes.count
        let storage = UnsafeMutableRawBufferPointer.allocate(
            byteCount: count,
            alignment: MemoryLayout<UInt8>.alignment
        )
        defer { storage.deallocate() }
        configBytes.withUnsafeBytes { src in
            storage.copyMemory(from: src)
        }
        let raw = UnsafeRawBufferPointer(storage)

        do {
            let ok = try await entryPoint(raw, recordHandler)
            finish(success: ok, error: nil)
        } catch {
            finish(success: false, error: "\(error)")
        }
    }

    @Sendable
    private static func pushRecord(_ json: String) {
        let wasmTests = JSObject.global.__wasm_tests
        guard let object = wasmTests.object else { return }
        let records = object.records
        guard let array = records.object else { return }
        _ = array.push!(json)
    }

    @Sendable
    private static func finish(success: Bool, error: String?) {
        let wasmTests = JSObject.global.__wasm_tests
        guard let object = wasmTests.object else { return }
        object.success = .boolean(success)
        if let error {
            object.error = .string(error)
        }
        object.done = .boolean(true)
    }
}

#else

/// Non-WASM stub so the package still builds on macOS for type-checking.
/// Tests that exercise the runner must run under the WASM SDK.
public enum BrowserTestRunner {
    public static func start(configurationJSON: String = #"{"verbosity":0}"#) {
        fatalError("BrowserTestRunner is only available on wasm32.")
    }

    public static func run(configurationJSON: String = #"{"verbosity":0}"#) {
        fatalError("BrowserTestRunner is only available on wasm32.")
    }
}

#endif
