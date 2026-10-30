// The touchpad protocol, revalidated here exactly like src/input.js
// `validateInput` and native/linux/src/protocol.rs, so the helper never
// trusts its parent blindly.

import Foundation

struct HelperError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

func fail(_ message: String) -> HelperError { HelperError(message: message) }

let maxLine = 8192

enum Button: String { case left, right }

/// Only named editing keys; no modifiers can be left held.
enum Key: String {
    case Backspace, Delete, Enter, Tab, Escape, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Home, End
}

enum Message: Equatable {
    case ping, release, focus
    case move(dx: Int, dy: Int)
    case scroll(dx: Int, dy: Int)
    case zoom(steps: Int)
    case button(Button, down: Bool)
    case text(target: String, text: String)
    case key(target: String, key: Key)
}

func validTarget(_ target: String) -> Bool {
    let bytes = Array(target.utf8)
    return (1...16).contains(bytes.count) && bytes[0] != UInt8(ascii: "0") && bytes.allSatisfy { $0 >= 0x30 && $0 <= 0x39 }
}

func validText(_ text: String) -> Bool {
    guard (1...1024).contains(text.utf16.count) else { return false }
    for scalar in text.unicodeScalars {
        let value = scalar.value
        if value <= 0x7f && (value < 0x20 || value == 0x7f) && value != 0x09 && value != 0x0a && value != 0x0d { return false }
    }
    return true
}

/// JSON numbers arrive as NSNumber; booleans are NSNumber too, so tell them apart.
func jsonInteger(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), !CFNumberIsFloatType(number) else { return nil }
    let wide = number.int64Value
    guard wide >= Int64(Int32.min), wide <= Int64(Int32.max) else { return nil }
    return Int(wide)
}

func jsonBool(_ value: Any?) -> Bool? {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
}

func jsonNumber(_ value: Any?) -> Double? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return number.doubleValue
}

func parse(_ line: String) throws -> Message {
    let invalid = fail("Invalid input.")
    guard let data = line.data(using: .utf8),
          let any = try? JSONSerialization.jsonObject(with: data, options: []),
          let object = any as? [String: Any],
          let type = object["type"] as? String else { throw invalid }
    let keys = Set(object.keys)
    func exact(_ names: String...) -> Bool { keys == Set(["type"] + names) }
    func delta(_ n: Int) -> Bool { abs(n) <= 2048 }
    switch type {
    case "ping" where exact(): return .ping
    case "release" where exact(): return .release
    case "focus" where exact(): return .focus
    case "move" where exact("dx", "dy"), "scroll" where exact("dx", "dy"):
        guard let dx = jsonInteger(object["dx"]), let dy = jsonInteger(object["dy"]), delta(dx), delta(dy) else { throw invalid }
        return type == "move" ? .move(dx: dx, dy: dy) : .scroll(dx: dx, dy: dy)
    case "zoom" where exact("steps"):
        guard let steps = jsonInteger(object["steps"]), (1...8).contains(abs(steps)) else { throw invalid }
        return .zoom(steps: steps)
    case "button" where exact("button", "down"):
        guard let name = object["button"] as? String, let button = Button(rawValue: name), let down = jsonBool(object["down"]) else { throw invalid }
        return .button(button, down: down)
    case "text" where exact("target", "text"):
        guard let target = object["target"] as? String, let text = object["text"] as? String, validTarget(target), validText(text) else { throw invalid }
        return .text(target: target, text: text)
    case "key" where exact("target", "key"):
        guard let target = object["target"] as? String, let name = object["key"] as? String, let key = Key(rawValue: name), validTarget(target) else { throw invalid }
        return .key(target: target, key: key)
    default: throw invalid
    }
}

enum Read {
    case line(String), eof, timeout
}

/// Newline-delimited reader with a per-line deadline, so a silent or crashed
/// parent can never leave a button held.
final class LineReader {
    private let fd: Int32
    private var buffer = [UInt8]()
    private var eof = false

    init(fd: Int32) { self.fd = fd }

    private func take(_ end: Int, skip: Int) throws -> Read {
        let bytes = Array(buffer[0..<end])
        buffer.removeFirst(end + skip)
        guard var line = String(bytes: bytes, encoding: .utf8) else { throw fail("Input is not UTF-8.") }
        if line.hasSuffix("\r") { line.removeLast() }
        return .line(line)
    }

    func next(timeout: TimeInterval) throws -> Read {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            if let end = buffer.firstIndex(of: 0x0a) {
                if end > maxLine { throw fail("Input too large.") }
                return try take(end, skip: 1)
            }
            if buffer.count > maxLine { throw fail("Input too large.") }
            if eof { return buffer.isEmpty ? .eof : try take(buffer.count, skip: 0) }
            let left = deadline.timeIntervalSinceNow
            if left <= 0 { return .timeout }
            var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            let ready = poll(&descriptor, 1, Int32(min(max(left * 1000, 1), Double(Int32.max))))
            if ready < 0 {
                if errno == EINTR { continue }
                throw fail(String(cString: strerror(errno)))
            }
            if ready == 0 { return .timeout }
            var chunk = [UInt8](repeating: 0, count: 4096)
            let count = read(fd, &chunk, chunk.count)
            if count < 0 {
                if errno == EINTR || errno == EAGAIN { continue }
                throw fail(String(cString: strerror(errno)))
            }
            if count == 0 { eof = true } else { buffer.append(contentsOf: chunk[0..<count]) }
        }
    }
}

private let emitLock = NSLock()

/// Write one JSON line to stdout. The lock keeps lines from different threads
/// whole. A parent that has gone away closes the pipe: SIGPIPE is ignored at
/// startup and the failed write is dropped, so the focus thread can never end
/// the helper before the main thread releases the buttons.
func emit(_ value: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
    data.append(0x0a)
    emitLock.lock()
    defer { emitLock.unlock() }
    try? FileHandle.standardOutput.write(contentsOf: data)
}

func warn(_ message: String) {
    try? FileHandle.standardError.write(contentsOf: Data((message + "\n").utf8))
}
