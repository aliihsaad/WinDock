// The Node host as a child process: found, started, watched and stopped.

import Foundation

struct HostError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

enum Node {
    /// The runtime a packaged app carries beside its host, if any.
    static var bundled: String? {
        guard let host = HostRoot.bundled else { return nil }
        let node = host.appendingPathComponent("node").path
        return FileManager.default.isExecutableFile(atPath: node) ? node : nil
    }

    /// Node 20+: an explicit WINDOCK_NODE wins, then the bundled runtime;
    /// otherwise the newest of the user's shell, nvm, Homebrew and the
    /// installer. A login shell without a terminal does not load nvm, so its
    /// versions are scanned directly.
    static func find(environment: [String: String] = ProcessInfo.processInfo.environment, home: String = NSHomeDirectory()) -> String? {
        if let override = environment["WINDOCK_NODE"], override.hasPrefix("/"), majorVersion(override) ?? 0 >= 20 { return override }
        if let bundled, majorVersion(bundled) ?? 0 >= 20 { return bundled }
        var candidates = [String]()
        if let fromShell = loginShell("command -v node") { candidates.append(fromShell) }
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            candidates += versions.map { "\(nvm)/\($0)/bin/node" }
        }
        candidates += ["\(home)/.volta/bin/node", "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        let usable = candidates.filter { $0.hasPrefix("/") }.compactMap { path in majorVersion(path).map { (path, $0) } }.filter { $0.1 >= 20 }
        return usable.max { a, b in a.1 < b.1 }?.0
    }

    /// One short command in the user's login shell; its output is a path, never run.
    static func loginShell(_ command: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let deadline = Date().addingTimeInterval(8)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if process.isRunning { process.terminate(); return nil }
        let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let path = output.split(separator: "\n").last.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
        return path.isEmpty ? nil : path
    }

    static func majorVersion(_ path: String) -> Int? {
        guard FileManager.default.isExecutableFile(atPath: path) else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = ["--version"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        process.waitUntilExit()
        let version = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        guard let match = version.range(of: #"v(\d+)\."#, options: .regularExpression) else { return nil }
        return Int(version[match].dropFirst().split(separator: ".")[0])
    }
}

/// Where server.js lives: set in the environment, carried inside a packaged
/// app, or recorded by a development build.
enum HostRoot {
    /// A packaged app carries the host in Contents/Resources/host.
    static var bundled: URL? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let host = resources.appendingPathComponent("host")
        return FileManager.default.fileExists(atPath: host.appendingPathComponent("server.js").path) ? host : nil
    }

    static func locate() throws -> URL {
        var candidates = [String]()
        if let override = ProcessInfo.processInfo.environment["WINDOCK_HOST_ROOT"] { candidates.append(override) }
        if let bundled { candidates.append(bundled.path) }
        if let recorded = Bundle.main.url(forResource: "host-root", withExtension: nil),
           let text = try? String(contentsOf: recorded, encoding: .utf8) {
            candidates.append(text.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        for candidate in candidates where candidate.hasPrefix("/") {
            let url = URL(fileURLWithPath: candidate)
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("server.js").path) { return url }
        }
        throw HostError(message: "The WinDock host folder was not found. Reinstall WinDock, or build the app again from the WinDock repository (npm run build:macos-app).")
    }
}

final class Host {
    let root: URL
    let node: String
    private(set) var process: Process?
    private(set) var endpoint = ""
    private(set) var pin = ""
    private(set) var lastError = ""
    private var stopping = false
    private var startedAt = Date()
    var onChange: (() -> Void)?
    var onExit: ((Int32, Bool) -> Void)?

    init(root: URL, node: String) {
        self.root = root
        self.node = node
    }

    var isRunning: Bool { process?.isRunning ?? false }
    var isReady: Bool { isRunning && endpoint.hasPrefix("http://") && pin.count == 4 }
    var port: Int { Int(URL(string: endpoint)?.port ?? 8620) }

    func start() throws {
        stopping = false
        endpoint = ""
        pin = ""
        lastError = ""
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [root.appendingPathComponent("server.js").path]
        process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        // The helper and the tools the host runs live beside node or in the usual places.
        let nodeDir = (node as NSString).deletingLastPathComponent
        environment["PATH"] = [nodeDir, "/opt/homebrew/bin", "/usr/local/bin", environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"].joined(separator: ":")
        process.environment = environment
        let stdout = Pipe(), stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        process.standardInput = FileHandle.nullDevice
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let text = String(decoding: handle.availableData, as: UTF8.self)
            if text.isEmpty { return }
            DispatchQueue.main.async { self?.readBanner(text) }
        }
        stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let text = String(decoding: handle.availableData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { return }
            DispatchQueue.main.async { self?.lastError = String(text.suffix(400)) }
        }
        process.terminationHandler = { [weak self] finished in
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                guard let self, self.process === finished else { return }
                self.process = nil
                self.onExit?(finished.terminationStatus, self.stopping)
                self.onChange?()
            }
        }
        try process.run()
        self.process = process
        startedAt = Date()
        onChange?()
    }

    private func readBanner(_ text: String) {
        for line in text.split(separator: "\n") {
            if let range = line.range(of: #"open:\s*(http://\S+)"#, options: .regularExpression) {
                endpoint = String(line[range].split(separator: ":", maxSplits: 1)[1]).trimmingCharacters(in: .whitespaces)
            }
            if let range = line.range(of: #"PIN:\s*(\d{4})"#, options: .regularExpression) {
                pin = String(line[range].suffix(4))
            }
        }
        onChange?()
    }

    var uptime: TimeInterval { Date().timeIntervalSince(startedAt) }

    /// Ask the host to finalize a recording before it goes away; loopback needs no PIN.
    func stopRecording(timeout: TimeInterval = 30) {
        guard isReady, let url = URL(string: "http://127.0.0.1:\(port)/api/capture/stop") else { return }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { _, _, _ in done.signal() }.resume()
        _ = done.wait(timeout: .now() + timeout)
    }

    func stop() {
        guard let process, process.isRunning else { return }
        stopping = true
        stopRecording()
        process.terminate()
        let deadline = Date().addingTimeInterval(5)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    }
}
