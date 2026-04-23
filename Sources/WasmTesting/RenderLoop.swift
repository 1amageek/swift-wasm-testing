// RenderLoop — `requestAnimationFrame` loop helper.
//
// Replaces the hand-rolled rAF closure each smoke executable used to keep:
//
//     nonisolated(unsafe) var rafClosure: JSClosure?
//     func startRenderLoop() {
//         let closure = JSClosure { args -> JSValue in
//             let ms = args.first?.number ?? 0
//             renderer.update(atTime: ms / 1000.0)
//             renderer.render()
//             frameCount += 1
//             if let next = rafClosure {
//                 _ = JSObject.global.requestAnimationFrame!(next)
//             }
//             return .undefined
//         }
//         rafClosure = closure
//         _ = JSObject.global.requestAnimationFrame!(closure)
//     }
//
// With this helper:
//
//     RenderLoop.start { seconds in
//         renderer.update(atTime: seconds)
//         renderer.render()
//         frameCount += 1
//     }
//
// The loop retains the underlying `JSClosure` internally. Calling
// `RenderLoop.stop()` breaks the chain after the next frame.

import Foundation

@MainActor
public final class RenderLoop {
    private nonisolated(unsafe) static var current: RenderLoop?

    private var closure: JSClosure?
    private var onFrame: @MainActor (Double) -> Void
    private var running: Bool = true

    private init(onFrame: @escaping @MainActor (Double) -> Void) {
        self.onFrame = onFrame
    }

    /// Schedule the given `onFrame` callback to run once per
    /// `requestAnimationFrame`. Time is passed in **seconds** (the raw
    /// `rAF` millisecond value is divided by 1000).
    ///
    /// Calling `start` a second time stops any existing loop and replaces
    /// it with the new callback.
    public static func start(
        onFrame: @escaping @MainActor (Double) -> Void
    ) {
        current?.running = false
        let loop = RenderLoop(onFrame: onFrame)
        let closure = JSClosure { args in
            let ms = args.first?.number ?? 0
            let seconds = ms / 1000.0
            if loop.running {
                loop.onFrame(seconds)
                if let next = loop.closure {
                    _ = JSObject.global.requestAnimationFrame!(next)
                }
            }
            return .undefined
        }
        loop.closure = closure
        current = loop
        _ = JSObject.global.requestAnimationFrame!(closure)
    }

    /// Stop the currently running loop after the next frame. No-op if no
    /// loop has been started.
    public static func stop() {
        current?.running = false
    }
}
