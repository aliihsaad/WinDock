// Display brightness through DisplayServices, the private framework the
// Displays settings pane uses. It is loaded at run time, so the helper builds
// without linking a private framework, and reports plainly when a display
// cannot be dimmed this way (external monitors speak DDC/CI, not covered yet).

import CoreGraphics
import Foundation

enum Brightness {
    private typealias GetFunction = @convention(c) (CGDirectDisplayID, UnsafeMutablePointer<Float>) -> Int32
    private typealias SetFunction = @convention(c) (CGDirectDisplayID, Float) -> Int32
    private typealias CanFunction = @convention(c) (CGDirectDisplayID) -> Bool

    private static let unavailable = "This display's brightness cannot be changed from WinDock yet. Built-in displays are supported; external monitors are not."

    private static func library() throws -> UnsafeMutableRawPointer {
        guard let handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY) else {
            throw fail(unavailable)
        }
        return handle
    }

    private static func symbol<T>(_ handle: UnsafeMutableRawPointer, _ name: String, as type: T.Type) throws -> T {
        guard let pointer = dlsym(handle, name) else { throw fail(unavailable) }
        return unsafeBitCast(pointer, to: type)
    }

    /// The display the user is looking at: the one with the menu bar.
    private static func display() throws -> CGDirectDisplayID {
        let id = CGMainDisplayID()
        let handle = try library()
        let can = try symbol(handle, "DisplayServicesCanChangeBrightness", as: CanFunction.self)
        guard can(id) else { throw fail(unavailable) }
        return id
    }

    /// Current level, 0...100.
    static func get() throws -> Int {
        let id = try display()
        let read = try symbol(try library(), "DisplayServicesGetBrightness", as: GetFunction.self)
        var level: Float = 0
        guard read(id, &level) == 0 else { throw fail(unavailable) }
        return Int((level * 100).rounded())
    }

    /// Set the level, 0...100, and read it back.
    static func set(_ percent: Int) throws -> Int {
        guard (0...100).contains(percent) else { throw fail("Brightness accepts 0..100.") }
        let id = try display()
        let write = try symbol(try library(), "DisplayServicesSetBrightness", as: SetFunction.self)
        guard write(id, Float(percent) / 100) == 0 else { throw fail(unavailable) }
        return try get()
    }
}
