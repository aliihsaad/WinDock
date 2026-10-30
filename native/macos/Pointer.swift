// The pointer, mirroring the uinput pointer on Linux and SendInput on Windows,
// as Quartz events posted at the HID level. Posting needs the Accessibility
// permission; the touchpad verb checks for it before reporting ready.

import AppKit
import CoreGraphics

final class Pointer {
    private var left = false
    private var right = false
    private var lastClick: (time: TimeInterval, point: CGPoint, button: Button)?
    private var clickState: Int64 = 1

    var holding: Bool { left || right }

    /// The real cursor, so a physical mouse and the phone never fight over a stale position.
    private var location: CGPoint { CGEvent(source: nil)?.location ?? .zero }

    private func post(_ event: CGEvent?) throws {
        guard let event else { throw fail("Could not create an input event.") }
        event.post(tap: .cghidEventTap)
    }

    /// Keep the cursor on a display; a point beyond every screen snaps to the nearest one.
    static func clamp(_ point: CGPoint) -> CGPoint {
        var count: UInt32 = 0
        var displays = [CGDirectDisplayID](repeating: 0, count: 16)
        guard CGGetActiveDisplayList(16, &displays, &count) == .success, count > 0 else { return point }
        var best = point
        var bestDistance = CGFloat.infinity
        for display in displays.prefix(Int(count)) {
            let bounds = CGDisplayBounds(display)
            let candidate = CGPoint(x: min(max(point.x, bounds.minX), bounds.maxX - 1), y: min(max(point.y, bounds.minY), bounds.maxY - 1))
            let distance = hypot(candidate.x - point.x, candidate.y - point.y)
            if distance < bestDistance { bestDistance = distance; best = candidate }
        }
        return best
    }

    func movement(dx: Int, dy: Int) throws {
        if dx == 0 && dy == 0 { return }
        let current = location
        let next = Pointer.clamp(CGPoint(x: current.x + CGFloat(dx), y: current.y + CGFloat(dy)))
        let type: CGEventType = left ? .leftMouseDragged : (right ? .rightMouseDragged : .mouseMoved)
        try post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: next, mouseButton: right && !left ? .right : .left))
    }

    func scroll(dx: Int, dy: Int) throws {
        if dx == 0 && dy == 0 { return }
        try post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0))
    }

    /// Pinch zoom as Command with = or -, which zooms browsers, editors and documents.
    func zoom(steps: Int) throws {
        if holding || steps == 0 { return }
        let code: CGKeyCode = steps > 0 ? 24 : 27
        for _ in 0..<min(abs(steps), 8) { try Keyboard.press(code, flags: .maskCommand) }
    }

    func button(_ button: Button, down: Bool) throws {
        let held = button == .left ? left : right
        if held == down { return }
        let point = location
        if down {
            let now = Date().timeIntervalSince1970
            if let last = lastClick, last.button == button, now - last.time < 0.5, hypot(last.point.x - point.x, last.point.y - point.y) < 4 {
                clickState = min(clickState + 1, 3)
            } else {
                clickState = 1
            }
            lastClick = (now, point, button)
        }
        let type: CGEventType = button == .left ? (down ? .leftMouseDown : .leftMouseUp) : (down ? .rightMouseDown : .rightMouseUp)
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button == .left ? .left : .right) else {
            throw fail("Could not create an input event.")
        }
        event.setIntegerValueField(.mouseEventClickState, value: clickState)
        event.post(tap: .cghidEventTap)
        if button == .left { left = down } else { right = down }
    }

    /// Only release buttons held by this session, never unrelated physical input.
    func release() throws {
        var failure: Error?
        if left { do { try button(.left, down: false) } catch { failure = error } }
        left = false
        if right { do { try button(.right, down: false) } catch { failure = error } }
        right = false
        if let failure { throw failure }
    }
}
