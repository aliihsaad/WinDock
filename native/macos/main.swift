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

/// The protocol validator alone, so the host's tests can exercise it without a desktop.
func parseLines() {
    while let line = readLine(strippingNewline: true) {
        do {
            let message = try parse(line)
            emit(["ok": true, "message": "\(message)"])
        } catch {
            emit(["ok": false, "error": "\(error)"])
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
