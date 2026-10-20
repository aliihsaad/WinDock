// windock-input — the macOS input surface WinDock needs, behind an argv interface.
//
// It speaks the same newline-delimited JSON protocol as the Windows and Linux
// helpers, so src/platform/input.js drives all three.
//
// Verbs:
//   touchpad                 stream pointer/keyboard input from stdin, emit ready/focus events
//   signature <dir>          render stdin strokes to a transparent PNG in <dir>
//   signature-insert <dir>   same, then copy it to the clipboard and paste with Command+V
//   parse                    validate protocol lines from stdin, one JSON verdict per line (no input)
//   check                    print which permissions are granted, as JSON
//
// Typed text and signature strokes are never written to stderr.
// Exit codes: 0 success, 1 usage error, 2 runtime failure.

import AppKit
import ApplicationServices
import Foundation

func usage(_ message: String) -> Never {
    warn(message)
    exit(1)
}

/// Read-only diagnostics: nothing is created, moved or typed.
func check() {
    emit([
        "accessibility": AXIsProcessTrusted(),
        "screenRecording": CGPreflightScreenCaptureAccess(),
        "frontmost": NSWorkspace.shared.frontmostApplication != nil,
    ])
}

/// The protocol validator alone, so the host's tests can exercise it without a
/// desktop. Lines go through the same bounded reader as the touchpad, and only
/// the message kind is echoed, never its text.
func parseLines() {
    let input = LineReader(fd: STDIN_FILENO)
    while true {
        do {
            guard case .line(let line) = try input.next(timeout: 60) else { return }
            let kind: String
            switch try parse(line) {
            case .ping: kind = "ping"
            case .release: kind = "release"
            case .focus: kind = "focus"
            case .move: kind = "move"
            case .scroll: kind = "scroll"
            case .zoom: kind = "zoom"
            case .button: kind = "button"
            case .text: kind = "text"
            case .key: kind = "key"
            }
            emit(["ok": true, "type": kind])
        } catch {
            emit(["ok": false, "error": "\(error)"])
            if "\(error)" == "Input too large." { return } // the stream is no longer line-aligned
        }
    }
}

let arguments = Array(CommandLine.arguments.dropFirst())
do {
    switch (arguments.count, arguments.first ?? "") {
    case (1, "touchpad"): try runTouchpad()
    case (2, "signature"): try saveSignature(dir: arguments[1], insert: false)
    case (2, "signature-insert"): try saveSignature(dir: arguments[1], insert: true)
    case (1, "parse"): parseLines()
    case (1, "check"): check()
    default: usage("usage: windock-input <touchpad | signature DIR | signature-insert DIR | parse | check>")
    }
    exit(0)
} catch {
    warn("\(error)")
    exit(2)
}
