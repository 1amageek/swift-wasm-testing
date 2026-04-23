// Smoke-level tests that the WasmTesting module compiles + surfaces the
// expected symbols. The actual harness / render-loop / reactor code can
// only run inside a browser WASM host, so these tests are intentionally
// narrow: they assert that the module type-checks and that public API
// names remain stable.

import Testing
@testable import WasmTesting

@Test func harnessTypeIsAvailable() {
    #expect(Harness.self == Harness.self)
}

@Test func renderLoopTypeIsAvailable() {
    #expect(RenderLoop.self == RenderLoop.self)
}

@Test func reactorBootNamespaceIsAvailable() {
    _ = WasmTestingReactor.self
}
