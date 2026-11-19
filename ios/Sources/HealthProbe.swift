import Foundation

/// A bounded, cookie-free probe. Redirects never select a different host for the user.
final class HealthProbe: NSObject, URLSessionDataDelegate {
    private var session: URLSession?
    private var completion: ((Bool) -> Void)?
    private var body = Data()
    private var validResponse = false

    func start(endpoint: URL, completion: @escaping (Bool) -> Void) {
        cancel()
        self.completion = completion
        body = Data()
        validResponse = false
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 20
        config.waitsForConnectivity = true
        config.httpShouldSetCookies = false
        config.urlCache = nil
        let session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        self.session = session
        session.dataTask(with: endpoint.appendingPathComponent("health")).resume()
    }

    func cancel() {
        completion = nil
        session?.invalidateAndCancel()
        session = nil
    }

    private func finish(_ success: Bool) {
        let callback = completion
        cancel()
        callback?(success)
    }

    static func isTara(_ body: Data) -> Bool {
        guard body.count <= 4096,
              let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return false }
        return object["app"] as? String == "tara" && object["ok"] as? Bool == true
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard session === self.session else { completionHandler(.cancel); return }
        validResponse = (response as? HTTPURLResponse)?.statusCode == 200 && response.expectedContentLength <= 4096
        completionHandler(validResponse ? .allow : .cancel)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard session === self.session else { return }
        guard body.count + data.count <= 4096 else { finish(false); return }
        body.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard session === self.session else { return }
        finish(error == nil && validResponse && Self.isTara(body))
    }
}
