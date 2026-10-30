// Typed text as Unicode key events, so emoji and every script arrive without a
// keyboard-layout mapping. Return and Tab are pressed as keys, which text
// fields, terminals and chat boxes all understand.

import CoreGraphics
import Foundation

enum Keyboard {
    static func keyCode(_ key: Key) -> CGKeyCode {
        switch key {
        case .Backspace: return 51
        case .Delete: return 117
        case .Enter: return 36
        case .Tab: return 48
        case .Escape: return 53
        case .ArrowLeft: return 123
        case .ArrowRight: return 124
        case .ArrowUp: return 126
        case .ArrowDown: return 125
        case .Home: return 115
        case .End: return 119
        }
    }

    static func press(_ code: CGKeyCode, flags: CGEventFlags = []) throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
            throw fail("Could not create a key event.")
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    /// Command+V on the key in the V position of the user's layout.
    static func paste() throws { try press(9, flags: .maskCommand) }

    private static func unicode(_ units: [UniChar]) throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
            throw fail("Could not create a key event.")
        }
        var copy = units
        down.keyboardSetUnicodeString(stringLength: copy.count, unicodeString: &copy)
        up.keyboardSetUnicodeString(stringLength: copy.count, unicodeString: &copy)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    /// Split into short events that keep surrogate pairs whole; Quartz drops long strings.
    static func chunks(_ text: String, size: Int = 20) -> [[UniChar]] {
        var out = [[UniChar]]()
        var chunk = [UniChar]()
        let units = Array(text.utf16)
        var index = 0
        while index < units.count {
            let unit = units[index]
            chunk.append(unit)
            if UTF16.isLeadSurrogate(unit), index + 1 < units.count {
                chunk.append(units[index + 1])
                index += 1
            }
            if chunk.count >= size { out.append(chunk); chunk = [] }
            index += 1
        }
        if !chunk.isEmpty { out.append(chunk) }
        return out
    }

    static func type(_ text: String) throws {
        guard validText(text) else { throw fail("Invalid text.") }
        var pending = ""
        func flush() throws {
            for chunk in chunks(pending) { try unicode(chunk) }
            pending = ""
        }
        var iterator = text.makeIterator()
        while let character = iterator.next() {
            switch character {
            case "\n", "\r", "\r\n": try flush(); try press(keyCode(.Enter))
            case "\t": try flush(); try press(keyCode(.Tab))
            default: pending.append(character)
            }
        }
        try flush()
    }
}
