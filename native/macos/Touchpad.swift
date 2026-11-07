// The persistent touchpad session, mirroring Touchpad.RunAsync on Windows
// and touchpad.rs on Linux.

import AppKit
import Foundation

/// One touchpad per user session, like the Windows `Local\WinDock.Touchpad` mutex.
/// The lock lives in the per-user temporary directory; without one that this
/// user owns, the lock is skipped rather than placed in a shared folder.
private func singleInstance() throws -> Int32? {
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
    guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, buffer.count) > 0 else { return nil }
    let directory = String(cString: buffer)
    var info = stat()
    guard stat(directory, &info) == 0, info.st_uid == getuid(), (info.st_mode & S_IFMT) == S_IFDIR else { return nil }
    let path = (directory as NSString).appendingPathComponent("windock-touchpad.lock")
    let fd = open(path, O_WRONLY | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { throw fail("Could not open the touchpad lock: \(String(cString: strerror(errno)))") }
    if flock(fd, LOCK_EX | LOCK_NB) != 0 {
        close(fd)
        throw fail("Another touchpad is active.")
    }
    return fd
}

let accessibilityHint = "Accessibility permission is not granted, so the touchpad cannot move the pointer or type. Open System Settings → Privacy & Security → Accessibility and allow the app that runs WinDock (your terminal), then reopen the touchpad."

func runTouchpad() throws {
    let lock = try singleInstance()
    defer { if let lock { close(lock) } }
    guard AXIsProcessTrusted() else {
        // Ask macOS to list the responsible app under Accessibility, so granting is one switch away.
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
        throw fail(accessibilityHint)
    }
    let pointer = Pointer()
    let focus = Focus.start()
    emit(["type": "ready"])
    var failure: Error?
    do { try session(pointer, focus) } catch { failure = error }
    // Also runs after a parse error, a stdin EOF, or the parent going quiet.
    do { try pointer.release() } catch { if failure == nil { failure = error } }
    focus.stop()
    if let failure { throw failure }
}

private func session(_ pointer: Pointer, _ focus: Focus) throws {
    let input = LineReader(fd: STDIN_FILENO)
    while true {
        // Releases buttons if Node crashes or stops forwarding the phone heartbeat.
        let line: String
        switch try input.next(timeout: 2) {
        case .line(let text): line = text
        case .eof, .timeout: return
        }
        switch try parse(line) {
        case .ping: break
        case .focus: focus.refresh()
        case .release: try pointer.release()
        case .move(let dx, let dy): try pointer.movement(dx: dx, dy: dy)
        case .scroll(let dx, let dy): try pointer.scroll(dx: dx, dy: dy)
        case .zoom(let steps): try pointer.zoom(steps: steps)
        case .button(let button, let down): try pointer.button(button, down: down)
        case .text(let target, let text): typeInto(pointer, focus, target) { try Keyboard.type(text) }
        case .key(let target, let key): typeInto(pointer, focus, target) { try Keyboard.press(Keyboard.keyCode(key)) }
        }
    }
}

/// Keyboard input goes only to the field the phone was told about. Any
/// failure is reported as an input-error, never with the text itself.
private func typeInto(_ pointer: Pointer, _ focus: Focus, _ target: String, _ send: () throws -> Void) {
    var failure: Error?
    if focus.accepts(target) {
        do { try pointer.release(); try send() } catch { failure = error }
    } else {
        failure = fail("Focus changed.")
    }
    if let failure {
        if "\(failure)" != "Focus changed." { warn("Keyboard input failed: \(failure)") }
        emit(["type": "input-error"])
        focus.refresh()
    }
}
