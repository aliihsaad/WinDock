// Opaque keyboard-focus tokens, like KeyboardFocus on Windows and focus.rs on
// Linux. The identity is the frontmost application plus, with the
// Accessibility permission, its focused element. Each new identity gets a
// fresh counter token; only the token and the editable/password flags leave
// the helper. Field names, values and passwords are never read.

import AppKit
import ApplicationServices

final class Focus {
    private struct State {
        var pid: pid_t = 0
        var identity = ""
        var editable = false
        var password = false
        var target = ""
        var revision: UInt64 = 0
    }

    private var state = State()
    private let lock = NSLock()
    private var requested = false
    private var stopped = false
    private let wake = DispatchSemaphore(value: 0)

    static let editableRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]

    /// The app in front right now. NSWorkspace's answer is a cached property
    /// that only a run loop refreshes, so ask the window server instead:
    /// Accessibility's focused application, or the owner of the top window.
    static func frontmostPid() -> pid_t {
        if AXIsProcessTrusted() {
            var application: CFTypeRef?
            if AXUIElementCopyAttributeValue(AXUIElementCreateSystemWide(), kAXFocusedApplicationAttribute as CFString, &application) == .success,
               let application, CFGetTypeID(application) == AXUIElementGetTypeID() {
                var pid: pid_t = 0
                if AXUIElementGetPid(application as! AXUIElement, &pid) == .success, pid > 0 { return pid }
            }
        }
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        if let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] {
            for window in windows where (window[kCGWindowLayer as String] as? Int) == 0 {
                if let pid = window[kCGWindowOwnerPID as String] as? pid_t, pid > 0 { return pid }
            }
        }
        return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
    }

    /// Metadata only: the app, an opaque element identity, and whether it takes text.
    static func identify() -> (pid: pid_t, identity: String, editable: Bool, password: Bool) {
        let pid = frontmostPid()
        guard pid > 0 else { return (0, "", false, false) }
        var identity = String(pid)
        var editable = false
        var password = false
        if AXIsProcessTrusted() {
            var focused: CFTypeRef?
            let system = AXUIElementCreateSystemWide()
            if AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
               let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
                let element = focused as! AXUIElement
                var owner: pid_t = 0
                AXUIElementGetPid(element, &owner)
                if owner == pid {
                    identity += ":\(CFHash(element))"
                    var roleValue: CFTypeRef?
                    var subroleValue: CFTypeRef?
                    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue)
                    AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subroleValue)
                    let role = roleValue as? String ?? ""
                    let subrole = subroleValue as? String ?? ""
                    password = subrole == "AXSecureTextField"
                    editable = password || editableRoles.contains(role)
                }
            }
        }
        return (pid, identity, editable, password)
    }

    static func start() -> Focus {
        let focus = Focus()
        let thread = Thread { focus.run() }
        thread.name = "windock-focus"
        thread.start()
        return focus
    }

    private func run() {
        var first = true
        while true {
            let (pid, identity, editable, password) = Focus.identify()
            lock.lock()
            if stopped { lock.unlock(); return }
            let changed = state.identity != identity || state.editable != editable || state.password != password
            if changed || state.target.isEmpty {
                let revision = state.revision + 1
                state = State(pid: pid, identity: identity, editable: editable, password: password, target: String(revision), revision: revision)
            }
            let report = changed || first || requested
            requested = false
            let snapshot = state
            lock.unlock()
            if report {
                emit(["type": "focus", "target": snapshot.target, "editable": snapshot.editable, "password": snapshot.password])
            }
            first = false
            _ = wake.wait(timeout: .now() + .milliseconds(250))
        }
    }

    /// The phone asked for the current token (keyboard button).
    func refresh() {
        lock.lock()
        requested = true
        lock.unlock()
        wake.signal()
    }

    /// Keyboard input needs the current token and the same focused element,
    /// read live: the cached state can be a tick old, and focus may have moved
    /// to another field of the same app, such as a password.
    func accepts(_ target: String) -> Bool {
        lock.lock()
        let current = state
        lock.unlock()
        guard !target.isEmpty, current.target == target else { return false }
        let live = Focus.identify()
        return live.pid == current.pid && live.identity == current.identity
    }

    func stop() {
        lock.lock()
        stopped = true
        lock.unlock()
        wake.signal()
    }
}
