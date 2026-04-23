// ReactorBoot — helpers for the WASI reactor-ABI boot shape used by every
// Open* smoke executable.
//
// The consumer still owns the `@_cdecl("setup")` export (WASI looks it up by
// symbol name at instantiation time), but this file centralises the two
// moving parts that every implementation got wrong at least once:
//
//  1. `JavaScriptEventLoop.installGlobalExecutor()` must be called before
//     the first `Task { ... }` hop, otherwise the executor is wired to a
//     degenerate fallback and async work never resumes.
//
//  2. Module-scope `let` / `var` read as zero inside the first `Task`
//     unless they are touched synchronously from `setup()` first — a known
//     reactor-ABI global-init race. `touchGlobals` is the idiomatic no-op
//     that forces lazy initialisers to run.
//
// Usage:
//
//     @_cdecl("setup")
//     public func setup() {
//         WasmTestingReactor.boot {
//             // touch every module-scope global you intend to read
//             statusText = "initializing"
//             frameCount = 0
//         } then: {
//             await performSetup()
//         }
//     }

import Foundation

public enum WasmTestingReactor {
    /// Wires up the JavaScriptKit async executor, runs `touchGlobals` on
    /// the synchronous reactor entry, then schedules `then` on a fresh
    /// `Task` so `await` hops resolve correctly.
    ///
    /// - Parameters:
    ///   - touchGlobals: synchronous closure invoked on the reactor entry
    ///     thread. Use it to read/write every module-scope `var` the
    ///     async portion will touch — this defeats the global-init race.
    ///   - then: async setup body. Runs on a detached `Task` once the
    ///     executor is installed.
    public static func boot(
        touchGlobals: () -> Void = {},
        then: @escaping @Sendable () async -> Void
    ) {
        touchGlobals()
        JavaScriptEventLoop.installGlobalExecutor()
        Task { await then() }
    }
}
