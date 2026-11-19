import UIKit
import WebKit

final class DockViewController: UIViewController, WKNavigationDelegate, UITextFieldDelegate {
    static let rememberedPCKey = "tara.pcAddress"
    private let defaults: UserDefaults
    private let autoConnect: Bool
    private let probe = HealthProbe()
    private let connection = UIScrollView()
    let address = UITextField()
    let status = UILabel()
    let connectButton = UIButton(type: .system)
    private let pcButton = UIButton(type: .system)
    private let spinner = UIActivityIndicatorView(style: .medium)
    private(set) var webView: WKWebView?
    private(set) var endpoint: URL?
    private var attempt = UUID()
    private var loadTimeout: DispatchWorkItem?
    private var started = false
    private let mint = UIColor(red: 0.51, green: 0.91, blue: 0.75, alpha: 1)

    init(defaults: UserDefaults = .standard, autoConnect: Bool = true) {
        self.defaults = defaults
        self.autoConnect = autoConnect
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(defaults:autoConnect:)") }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { webView != nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.035, green: 0.055, blue: 0.063, alpha: 1)
        view.tintColor = mint
        buildConnectionScreen()
        buildPCMenu()
        address.text = defaults.string(forKey: Self.rememberedPCKey)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !started {
            started = true
            if autoConnect && EndpointPolicy.normalize(address.text) != nil { connect() }
        }
    }

    private func label(_ text: String, size: CGFloat, weight: UIFont.Weight = .regular) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textColor = .white
        label.font = .systemFont(ofSize: size, weight: weight)
        label.numberOfLines = 0
        label.adjustsFontForContentSizeCategory = true
        return label
    }

    private func buildConnectionScreen() {
        connection.translatesAutoresizingMaskIntoConstraints = false
        connection.keyboardDismissMode = .interactive
        view.addSubview(connection)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            connection.topAnchor.constraint(equalTo: safe.topAnchor),
            connection.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            connection.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            connection.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
        let brand = label("Tara", size: 17, weight: .semibold)
        let mark = BrandMark()
        NSLayoutConstraint.activate([mark.widthAnchor.constraint(equalToConstant: 38), mark.heightAnchor.constraint(equalToConstant: 38)])
        let brandRow = UIStackView(arrangedSubviews: [mark, brand])
        brandRow.spacing = 12
        brandRow.alignment = .center
        let title = label("Your PC.\nWithin reach.", size: 34, weight: .bold)
        let intro = label("A little space for your Windows apps.\nKeep both devices on the same Wi-Fi.", size: 14)
        intro.textColor = .secondaryLabel
        let left = UIStackView(arrangedSubviews: [brandRow, title, intro])
        left.axis = .vertical
        left.spacing = 18
        left.alignment = .leading

        let heading = label("Connect to your PC", size: 21, weight: .semibold)
        let hint = label("On Windows, open the Tara tray menu → Show connection info. Enter the address shown there.", size: 13)
        hint.textColor = .secondaryLabel
        address.accessibilityIdentifier = "pc-address"
        address.accessibilityLabel = "PC address"
        address.placeholder = "192.168.1.20:8620"
        address.keyboardType = .URL
        address.autocapitalizationType = .none
        address.autocorrectionType = .no
        address.spellCheckingType = .no
        address.smartQuotesType = .no
        address.smartDashesType = .no
        address.returnKeyType = .go
        address.clearButtonMode = .whileEditing
        address.font = .monospacedSystemFont(ofSize: 16, weight: .regular)
        address.backgroundColor = UIColor.white.withAlphaComponent(0.065)
        address.layer.cornerRadius = 12
        address.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
        address.leftViewMode = .always
        address.heightAnchor.constraint(equalToConstant: 48).isActive = true
        address.delegate = self
        var config = UIButton.Configuration.filled()
        config.title = "Connect"
        config.image = UIImage(systemName: "arrow.right")
        config.imagePlacement = .trailing
        config.imagePadding = 10
        config.baseBackgroundColor = mint
        config.baseForegroundColor = UIColor(red: 0.04, green: 0.11, blue: 0.10, alpha: 1)
        config.cornerStyle = .medium
        connectButton.configuration = config
        connectButton.heightAnchor.constraint(equalToConstant: 46).isActive = true
        connectButton.accessibilityIdentifier = "connect"
        connectButton.addTarget(self, action: #selector(connect), for: .touchUpInside)
        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabel
        status.numberOfLines = 0
        status.text = "Your PC will ask you to pair with a PIN."
        status.accessibilityIdentifier = "connection-status"
        let statusRow = UIStackView(arrangedSubviews: [spinner, status])
        statusRow.spacing = 8
        statusRow.alignment = .top
        spinner.hidesWhenStopped = true
        let right = UIStackView(arrangedSubviews: [heading, hint, address, connectButton, statusRow])
        right.axis = .vertical
        right.spacing = 12
        let columns = UIStackView(arrangedSubviews: [left, right])
        columns.distribution = .fillEqually
        columns.alignment = .center
        columns.spacing = 36
        columns.translatesAutoresizingMaskIntoConstraints = false
        connection.addSubview(columns)
        NSLayoutConstraint.activate([
            columns.leadingAnchor.constraint(equalTo: connection.contentLayoutGuide.leadingAnchor, constant: 28),
            columns.trailingAnchor.constraint(equalTo: connection.contentLayoutGuide.trailingAnchor, constant: -28),
            columns.topAnchor.constraint(equalTo: connection.contentLayoutGuide.topAnchor, constant: 24),
            columns.bottomAnchor.constraint(equalTo: connection.contentLayoutGuide.bottomAnchor, constant: -24),
            columns.widthAnchor.constraint(equalTo: connection.frameLayoutGuide.widthAnchor, constant: -56)
        ])
        let height = columns.heightAnchor.constraint(greaterThanOrEqualTo: connection.frameLayoutGuide.heightAnchor, constant: -48)
        height.priority = .defaultLow
        height.isActive = true
    }

    private func buildPCMenu() {
        var config = UIButton.Configuration.gray()
        config.image = UIImage(systemName: "ellipsis")
        config.baseForegroundColor = .white
        config.background.backgroundColor = UIColor.black.withAlphaComponent(0.5)
        config.cornerStyle = .capsule
        pcButton.configuration = config
        pcButton.accessibilityLabel = "PC connection options"
        pcButton.accessibilityIdentifier = "pc-options"
        pcButton.showsMenuAsPrimaryAction = true
        pcButton.menu = UIMenu(children: [
            UIAction(title: "Reconnect", image: UIImage(systemName: "arrow.clockwise")) { [weak self] _ in self?.connect() },
            UIAction(title: "Change PC", image: UIImage(systemName: "desktopcomputer")) { [weak self] _ in self?.showConnection() }
        ])
        pcButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pcButton)
        NSLayoutConstraint.activate([
            pcButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            pcButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            pcButton.widthAnchor.constraint(equalToConstant: 44), pcButton.heightAnchor.constraint(equalToConstant: 44)
        ])
        pcButton.isHidden = true
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool { connect(); return true }

    @objc func connect() {
        showConnection()
        view.endEditing(true)
        guard let endpoint = EndpointPolicy.normalize(address.text) else {
            status.text = "Enter a local PC address, for example 192.168.1.20:8620."
            return
        }
        self.endpoint = endpoint
        let id = attempt
        connectButton.isEnabled = false
        address.isEnabled = false
        spinner.startAnimating()
        status.text = "Looking for Tara… Allow Local Network access if asked."
        probe.start(endpoint: endpoint) { [weak self] found in
            guard let self, self.attempt == id else { return }
            guard found else {
                self.showConnection(message: "Couldn’t reach Tara. Check the tray address, Wi-Fi, Windows firewall and Settings → Privacy & Security → Local Network, then retry.")
                return
            }
            self.loadDock(endpoint, attempt: id)
        }
    }

    private func loadDock(_ endpoint: URL, attempt id: UUID) {
        guard let rules = try? EndpointPolicy.contentRules(for: endpoint) else {
            showConnection(message: "Couldn’t prepare the dock. Please try again."); return
        }
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "tara-pc", encodedContentRuleList: rules) { [weak self] rules, error in
            guard let self, self.attempt == id else { return }
            guard let rules, error == nil else {
                self.showConnection(message: "Couldn’t prepare the dock. Please try again."); return
            }
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .default() // HttpOnly pairing cookie survives switching/reopening the app.
            config.userContentController.add(rules)
            let web = WKWebView(frame: .zero, configuration: config)
            web.navigationDelegate = self
            web.isOpaque = false
            web.backgroundColor = self.view.backgroundColor
            web.scrollView.backgroundColor = self.view.backgroundColor
            web.scrollView.contentInsetAdjustmentBehavior = .never
            web.scrollView.bounces = false
            web.allowsBackForwardNavigationGestures = false
            web.translatesAutoresizingMaskIntoConstraints = false
            self.view.insertSubview(web, belowSubview: self.connection)
            NSLayoutConstraint.activate([
                web.leadingAnchor.constraint(equalTo: self.view.leadingAnchor), web.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
                web.topAnchor.constraint(equalTo: self.view.topAnchor), web.bottomAnchor.constraint(equalTo: self.view.bottomAnchor)
            ])
            self.webView = web
            self.status.text = "Opening your dock…"
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, self.attempt == id else { return }
                self.showConnection(message: "The dock took too long to load. Check that Tara is still running, then retry.")
            }
            self.loadTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
            web.load(URLRequest(url: endpoint))
        }
    }

    func showConnection(message: String = "Enter your PC address to connect.") {
        attempt = UUID()
        probe.cancel()
        loadTimeout?.cancel()
        loadTimeout = nil
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.removeFromSuperview()
        webView = nil // Close sockets and release any remote gestures with the old page.
        endpoint = nil
        pcButton.isHidden = true
        connection.isHidden = false
        connectButton.isEnabled = true
        address.isEnabled = true
        spinner.stopAnimating()
        status.text = message
        UIApplication.shared.isIdleTimerDisabled = false
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let endpoint, navigationAction.targetFrame != nil,
              EndpointPolicy.allows(navigationAction.request.url, endpoint: endpoint) else {
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard let endpoint, EndpointPolicy.allows(navigationResponse.response.url, endpoint: endpoint) else {
            decisionHandler(.cancel); return
        }
        if navigationResponse.isForMainFrame,
           let response = navigationResponse.response as? HTTPURLResponse, !(200...299).contains(response.statusCode) {
            decisionHandler(.cancel)
            showConnection(message: "Tara couldn’t open the dock. Check the PC and retry.")
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView, let endpoint else { return }
        loadTimeout?.cancel()
        loadTimeout = nil
        defaults.set(endpoint.absoluteString, forKey: Self.rememberedPCKey)
        address.text = endpoint.absoluteString
        connection.isHidden = true
        pcButton.isHidden = false
        spinner.stopAnimating()
        UIApplication.shared.isIdleTimerDisabled = true
        setNeedsUpdateOfHomeIndicatorAutoHidden()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(webView, error) }
    private func failed(_ web: WKWebView, _ error: Error) {
        guard web === webView, (error as NSError).code != NSURLErrorCancelled else { return }
        showConnection(message: "Connection interrupted. Check your PC and Wi-Fi, then reconnect.")
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView else { return }
        showConnection(message: "The dock was paused by iOS. Tap Connect to reopen it.")
    }
    deinit { probe.cancel(); loadTimeout?.cancel() }
}

private final class BrandMark: UIView {
    override func draw(_ rect: CGRect) {
        let colors: [UIColor] = [
            UIColor(red: 0.51, green: 0.91, blue: 0.75, alpha: 1),
            UIColor(red: 0.78, green: 0.98, blue: 0.91, alpha: 1),
            UIColor(red: 0.50, green: 0.73, blue: 1, alpha: 1),
            UIColor(red: 0.41, green: 0.85, blue: 0.80, alpha: 1)
        ]
        for i in 0..<4 {
            colors[i].setFill()
            let size = bounds.width * 0.42
            UIBezierPath(roundedRect: CGRect(x: CGFloat(i % 2) * bounds.width * 0.58,
                                            y: CGFloat(i / 2) * bounds.height * 0.58,
                                            width: size, height: size), cornerRadius: 4).fill()
        }
    }
}
