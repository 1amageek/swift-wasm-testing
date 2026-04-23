// Harness — installs `window.__<name>_test` exposing Swift-side state to
// Playwright / the browser console.
//
// Consumer pattern before this file existed (copy-pasted across OCA, OSK,
// megaman):
//
//     let getStatus = JSClosure { _ -> JSValue in .string(statusText) }
//     // ... 10+ more closures ...
//     installedClosures = [getStatus, ...]   // retain manually
//     let harness = JSObject.global.Object.function!.new()
//     harness.getStatus = .object(getStatus)
//     // ... 10+ more assignments ...
//     JSObject.global.__osk_test = .object(harness)
//
// With this helper:
//
//     Harness.install(as: "__osk_test") { h in
//         h.expose("getStatus") { .string(statusText) }
//         h.expose("getFrameCount") { .number(Double(frameCount)) }
//         h.expose("spawnDynamic") { spawnDynamic() }
//     }
//
// The returned `Harness` object retains every `JSClosure` for the lifetime
// of the process via a private module-scope retainer. JSClosures are
// destroyed if their Swift owner goes out of scope, so this retention is
// mandatory for any harness used across rAF ticks.

import Foundation

@MainActor
public final class Harness {
    private nonisolated(unsafe) static var installed: [Harness] = []

    private let globalName: String
    private var bindings: [(name: String, closure: JSClosure)] = []

    private init(as globalName: String) {
        self.globalName = globalName
    }

    /// Create a harness, register the members provided in `configure`, then
    /// install it at `window[<globalName>]`. The harness and its closures
    /// are retained internally for the lifetime of the process.
    @discardableResult
    public static func install(
        as globalName: String,
        _ configure: (Harness) -> Void
    ) -> Harness {
        let harness = Harness(as: globalName)
        configure(harness)
        harness.commit()
        installed.append(harness)
        return harness
    }

    /// Expose a JS-readable member that returns a value synchronously.
    @discardableResult
    public func expose(
        _ name: String,
        returning body: @escaping @Sendable () -> JSValue
    ) -> Self {
        let closure = JSClosure { _ in body() }
        bindings.append((name, closure))
        return self
    }

    /// Expose an action that takes no arguments and returns `undefined`.
    @discardableResult
    public func expose(
        _ name: String,
        action body: @escaping @Sendable () -> Void
    ) -> Self {
        let closure = JSClosure { _ in
            body()
            return .undefined
        }
        bindings.append((name, closure))
        return self
    }

    /// Expose a member that receives the raw JS argument list and returns
    /// any `JSValue`. Use this for harness methods that accept parameters.
    @discardableResult
    public func expose(
        _ name: String,
        _ body: @escaping @Sendable ([JSValue]) -> JSValue
    ) -> Self {
        let closure = JSClosure(body)
        bindings.append((name, closure))
        return self
    }

    private func commit() {
        let object = JSObject.global.Object.function!.new()
        for (name, closure) in bindings {
            object[dynamicMember: name] = .object(closure)
        }
        JSObject.global[dynamicMember: globalName] = .object(object)
    }
}
