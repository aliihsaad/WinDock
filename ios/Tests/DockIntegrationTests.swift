import XCTest
import UIKit
import WebKit
@testable import WinDock

/// Hosted simulator tests against the real Node host with a fake Windows provider.
/// No test hooks or native JavaScript bridges are shipped in the application.
@MainActor
final class DockIntegrationTests: XCTestCase {
    private var controller: DockViewController!
    private var defaults: UserDefaults!
    private let endpoint = "http://127.0.0.1:18622"

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "WinDockSimulatorTests")!
        defaults.removePersistentDomain(forName: "WinDockSimulatorTests")
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        installController(autoConnect: false)
    }

    override func tearDown() async throws {
        controller.showConnection()
        defaults.removePersistentDomain(forName: "WinDockSimulatorTests")
    }

    private func installController(autoConnect: Bool) {
        controller?.showConnection()
        controller = DockViewController(defaults: defaults, autoConnect: autoConnect)
        let delegate = UIApplication.shared.delegate as! AppDelegate
        delegate.window!.rootViewController = controller
        delegate.window!.makeKeyAndVisible()
        controller.loadViewIfNeeded()
    }

    private func waitUntil(_ description: String, seconds: Double = 20,
                           _ condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out: \(description)")
        throw NSError(domain: "WinDockTests", code: 1, userInfo: [NSLocalizedDescriptionKey: description])
    }

    private func js(_ script: String) async throws -> Any? {
        let web = try XCTUnwrap(controller.webView)
        return try await web.evaluateJavaScript(script)
    }

    private func waitForJS(_ expression: String) async throws {
        try await waitUntil(expression) { [self] in
            guard controller.webView != nil else { return false }
            return (try? await js("Boolean(\(expression))")) as? Bool == true
        }
    }

    private func screenshot(_ name: String) async throws {
        let image: UIImage
        if let web = controller.webView {
            // A DOM assertion can pass before WebKit's separate renderer has painted.
            // Wait for drawer animations, then snapshot that renderer directly.
            try await Task.sleep(nanoseconds: 350_000_000)
            let config = WKSnapshotConfiguration()
            config.afterScreenUpdates = true
            image = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UIImage, Error>) in
                web.takeSnapshot(with: config) { image, error in
                    if let error { continuation.resume(throwing: error) }
                    else if let image { continuation.resume(returning: image) }
                    else { continuation.resume(throwing: NSError(domain: "WinDockSnapshot", code: 1)) }
                }
            }
        } else {
            image = UIGraphicsImageRenderer(bounds: controller.view.bounds).image { _ in
                controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true)
            }
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testConnectPairLaunchReconnectAndRememberPC() async throws {
        try await screenshot("01-connection")
        controller.address.text = endpoint
        controller.connectButton.sendActions(for: .touchUpInside)
        try await waitForJS("document.getElementById('pair') && !document.getElementById('pair').hidden")
        XCTAssertTrue(controller.view.bounds.width > controller.view.bounds.height, "Landscape presentation")
        try await screenshot("02-pairing")
        _ = try await js("document.getElementById('pin').value='0000'; document.querySelector('#pair-form button').click(); true")
        try await waitForJS("document.getElementById('pair-error').textContent.length > 0")
        _ = try await js("document.getElementById('pin').value='864213'; document.querySelector('#pair-form button').click(); true")
        try await waitForJS("!document.getElementById('app').hidden && document.querySelectorAll('.tile').length === 5")
        try await waitForJS("document.getElementById('conn').textContent === 'Connected'")
        try await waitForJS("Array.from(document.querySelectorAll('.tile img')).filter(i => i.complete && i.naturalWidth > 0).length === 5")
        let pageCount = try await js("document.querySelectorAll('.dock-page').length") as? Int
        XCTAssertEqual(pageCount, 2)
        _ = try await js("document.querySelector('.tile[data-key=\"ios-1\"]').click(); true")
        try await waitForJS("document.querySelector('.tile[data-key=\"ios-1\"]').classList.contains('is-running')")
        _ = try await js("document.querySelector('.tile[data-key=\"ios-1\"]').click(); true")
        try await screenshot("03-dock")
        _ = try await js("document.getElementById('drawer-open').click(); true")
        try await waitForJS("document.getElementById('drawer').open")
        try await screenshot("04-drawer")
        _ = try await js("document.getElementById('drawer-close').click(); true")
        let remembered = defaults.string(forKey: DockViewController.rememberedPCKey)
        XCTAssertEqual(remembered, endpoint)
        controller.showConnection()
        controller.connect()
        try await waitForJS("document.getElementById('app') && !document.getElementById('app').hidden && document.querySelectorAll('.tile').length === 5")
        try await waitForJS("document.getElementById('conn').textContent === 'Connected'")
        // New native controller, same persisted address and HttpOnly pairing cookie.
        installController(autoConnect: true)
        try await waitForJS("document.getElementById('app') && !document.getElementById('app').hidden")
        try await waitForJS("document.getElementById('conn').textContent === 'Connected'")
    }

    func testInvalidUnreachableRedirectedAndNonWinDockHostsRecover() async throws {
        controller.address.text = "https://example.com"
        controller.connect()
        XCTAssertTrue(controller.status.text!.contains("local PC address"))
        XCTAssertNil(controller.webView)
        for address in ["127.0.0.1:1", "127.0.0.1:18623", "127.0.0.1:18624", "127.0.0.1:18625"] {
            controller.address.text = address
            controller.connect()
            try await waitUntil("Failure recovers for \(address)", seconds: 25) { [self] in controller.connectButton.isEnabled }
            XCTAssertTrue(controller.status.text!.contains("Couldn’t reach WinDock"), address)
            XCTAssertNil(controller.webView)
            XCTAssertNil(defaults.string(forKey: DockViewController.rememberedPCKey))
        }
        try await screenshot("05-retry")
        controller.address.text = endpoint
        controller.connect()
        try await waitForJS("document.getElementById('pair') && !document.getElementById('pair').hidden")
    }

    func testWebViewBlocksForeignNavigationAndSubresources() async throws {
        controller.address.text = endpoint
        controller.connect()
        try await waitForJS("document.getElementById('pair')")
        _ = try await js("""
            const foreign = 'http://127.0.0.1:18626';
            const image = new Image(); image.src = foreign + '/image.png'; document.body.append(image);
            const script = document.createElement('script'); script.src = foreign + '/script.js'; document.head.append(script);
            fetch(foreign + '/data').catch(() => {});
            location.href = foreign + '/navigation'; true
            """)
        // Allow rejected subresource requests and cancelled navigation to settle.
        try await Task.sleep(nanoseconds: 1_000_000_000)
        XCTAssertEqual(controller.webView?.url?.host, "127.0.0.1")
        XCTAssertEqual(controller.webView?.url?.port, 18622)
        let (body, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18626/hits")!)
        let hits = try JSONDecoder().decode([String].self, from: body)
        XCTAssertEqual(hits, [], "No foreign navigation, script, image or fetch should reach the other origin")
    }
}
