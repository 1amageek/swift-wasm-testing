// Minimal reactor-ABI executable that validates the BrowserTestRunner
// pipeline end-to-end on WASM: the `@Test` functions below register into
// `__swift5_tests`, `setup()` boots the runner, and the runner discovers
// + executes them while streaming ABI v0 JSON records to `window.__wasm_tests`.
//
// This target is not shipped as a product; it exists to catch regressions
// in the integration (symbol resolution for `swt_abiv0_getEntryPoint`,
// executor activation order, record-handler forwarding) before downstream
// consumers hit them.

import Testing
import WasmTesting

@_cdecl("setup")
public func setup() {
    BrowserTestRunner.start()
}

@Test func arithmeticHolds() {
    #expect(1 + 1 == 2)
}

@Test func stringConcatenationHolds() {
    #expect("foo" + "bar" == "foobar")
}

@Test func demonstratesFailureRecording() {
    // Intentionally passes — exists so the runner surfaces at least two
    // testStarted/testEnded pairs in the record stream for CLI smoke
    // testing. Flip to a failing expectation when verifying failure paths.
    #expect([1, 2, 3].count == 3)
}
