// WasmTesting — Swift-side umbrella.
//
// Re-exports JavaScriptKit + JavaScriptEventLoop so consumers only need a
// single `import WasmTesting` to access both the harness / render-loop
// helpers and the underlying bridging types.

@_exported import JavaScriptKit
@_exported import JavaScriptEventLoop
