// The status item and its menu, mirroring native/tray/Program.cs on Windows.

import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let smoke: Bool
    private var statusItem: NSStatusItem!
    private let menu = NSMenu()
    private let statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    private let loginItem = NSMenuItem(title: "Start at login", action: #selector(toggleLogin), keyEquivalent: "")
    private let restartItem = NSMenuItem(title: "Restart host", action: #selector(restartHost), keyEquivalent: "")
    private var host: Host?
    private var failures = 0
    private var smokeDeadline: Timer?

    init(smoke: Bool) {
        self.smoke = smoke
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "dock.rectangle", accessibilityDescription: "WinDock")
            button.image?.isTemplate = true
        }
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Show connection info", action: #selector(showInfo), keyEquivalent: "")
        menu.addItem(withTitle: "Copy URL", action: #selector(copyUrl), keyEquivalent: "")
        menu.addItem(withTitle: "Open the dock in a browser", action: #selector(openDock), keyEquivalent: "")
        let saved = NSMenuItem(title: "Open saved files", action: nil, keyEquivalent: "")
        let savedMenu = NSMenu()
        savedMenu.addItem(withTitle: "Screenshots", action: #selector(openScreenshots), keyEquivalent: "")
        savedMenu.addItem(withTitle: "Recordings", action: #selector(openRecordings), keyEquivalent: "")
        savedMenu.addItem(withTitle: "Signatures", action: #selector(openSignatures), keyEquivalent: "")
        saved.submenu = savedMenu
        menu.addItem(saved)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(loginItem)
        menu.addItem(restartItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit WinDock", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        menu.delegate = self
        statusItem.menu = menu

        if smoke {
            smokeDeadline = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
                self?.fail("Timed out waiting for the server banner.")
            }
        }
        startHost()
    }

    // MARK: host lifecycle

    private func startHost() {
        do {
            let root = try HostRoot.locate()
            guard let node = Node.find() else {
                throw HostError(message: "Node.js 20 or newer was not found. Install it (for example `brew install node`) and open WinDock again.")
            }
            let host = Host(root: root, node: node)
            host.onChange = { [weak self] in self?.refresh() }
            host.onExit = { [weak self] code, requested in self?.hostExited(code: code, requested: requested) }
            self.host = host
            try host.start()
            if smoke { print("node: \(node)\nhost: \(root.path)") }
        } catch {
            fail("\(error)")
        }
    }

    private func hostExited(code: Int32, requested: Bool) {
        if requested { return }
        let detail = host?.lastError ?? ""
        // A host that ran for a while is restarted; one that dies at once is reported.
        // A long run clears earlier failures, so crashes days apart never add up.
        let uptime = host?.uptime ?? 0
        if uptime > 600 { failures = 0 }
        if uptime > 10 && failures < 3 {
            failures += 1
            statusLine.title = "Host stopped (code \(code)). Restarting…"
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self, let host = self.host, !host.isRunning else { return }
                try? host.start()
            }
            return
        }
        fail("The server exited with code \(code). \(detail)")
    }

    private func fail(_ message: String) {
        if smoke {
            FileHandle.standardError.write(Data("TRAY FAILED: \(message)\n".utf8))
            host?.stop()
            exit(1)
        }
        statusLine.title = "Not running"
        let alert = NSAlert()
        alert.messageText = "WinDock could not run its server."
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func refresh() {
        guard let host else { return }
        if host.isReady {
            statusLine.title = "Running · \(host.endpoint) · PIN \(host.pin)"
            if smoke {
                let login = SMAppService.mainApp.status == .enabled ? "enabled" : "not enabled"
                print("TRAY OK: server started, URL and PIN received\nlogin item: \(login)")
                host.stop()
                exit(0)
            }
        } else if host.isRunning {
            statusLine.title = "Starting…"
        } else {
            statusLine.title = "Not running"
        }
        restartItem.isEnabled = true
    }

    // MARK: actions

    @objc private func showInfo() {
        let alert = NSAlert()
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        alert.messageText = "WinDock \(version)"
        if let host, host.isReady {
            alert.informativeText = "Open this address on your phone:\n\n\(host.endpoint)\n\nPairing PIN: \(host.pin)\n\nBoth devices must be on the same network."
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Copy URL")
        } else {
            alert.informativeText = "The server is not running yet."
            alert.addButton(withTitle: "OK")
        }
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn { copyUrl() }
    }

    @objc private func copyUrl() {
        guard let host, host.isReady else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(host.endpoint, forType: .string)
    }

    @objc private func openDock() {
        guard let host, host.isReady, let url = URL(string: host.endpoint) else { return }
        NSWorkspace.shared.open(url)
    }

    private func openFolder(_ parts: [String]) {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let folder = parts.reduce(home) { $0.appendingPathComponent($1) }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        NSWorkspace.shared.open(folder)
    }

    @objc private func openScreenshots() { openFolder(["Pictures", "WinDock"]) }
    @objc private func openRecordings() { openFolder(["Movies", "WinDock"]) }
    @objc private func openSignatures() { openFolder(["Pictures", "WinDock", "Signatures"]) }

    @objc private func toggleLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled { try service.unregister() } else { try service.register() }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Could not change the login item."
            alert.informativeText = "\(error.localizedDescription)\n\nKeep WinDock in your Applications folder and try again."
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    @objc private func restartHost() {
        failures = 0
        host?.stop()
        host = nil
        startHost()
    }

    @objc private func quit() {
        host?.stop()
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        host?.stop()
    }
}

extension AppDelegate: NSMenuDelegate {
    func menuWillOpen(_ menu: NSMenu) {
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        refresh()
    }
}
