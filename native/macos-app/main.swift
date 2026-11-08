// WinDock for macOS: the menu bar companion. It runs the Node host, shows the
// address and PIN, opens the saved files, and can start at login.
//
// `--smoke` starts the host, prints "TRAY OK" once the address and PIN have
// arrived, stops it and exits, so the test suite can prove the wiring.

import AppKit

let app = NSApplication.shared
let delegate = AppDelegate(smoke: CommandLine.arguments.contains("--smoke"))
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
