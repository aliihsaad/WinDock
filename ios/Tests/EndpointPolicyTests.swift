import XCTest
@testable import Tara

final class EndpointPolicyTests: XCTestCase {
    func testLocalAddressesAndDefaultPorts() {
        let valid = [
            "192.168.1.20": "http://192.168.1.20:8620",
            " 10.2.3.4:9000 ": "http://10.2.3.4:9000",
            "172.16.0.1": "http://172.16.0.1:8620",
            "172.31.255.254": "http://172.31.255.254:8620",
            "http://192.168.1.20/": "http://192.168.1.20",
            "https://192.168.1.20:9443": "https://192.168.1.20:9443",
            "localhost": "http://localhost:8620",
            "127.0.0.1:18622": "http://127.0.0.1:18622"
        ]
        for (input, expected) in valid { XCTAssertEqual(EndpointPolicy.normalize(input)?.absoluteString, expected, input) }
    }

    func testRejectsAmbiguousOrPublicAddresses() {
        let invalid = ["", "example.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.1.1",
                       "256.1.1.1", "192.168.001.1", "0xc0a80101", "3232235777", "192.168.1",
                       "http://user@192.168.1.1", "http://192.168.1.1.evil.com", "http://[::1]",
                       "file:///tmp/test", "javascript:alert(1)", "ftp://192.168.1.1",
                       "192.168.1.1/path", "192.168.1.1?x=1", "192.168.1.1#foo", "192.168.1.1:0",
                       "192.168.1.1:65536", "192.168.1.1:", "http://192.168.1.1:",
                       "http://192.168.1.1\\@evil.com", "http://%31%32%37.0.0.1", "http://192.168.1.1\n/",
                       String(repeating: "a", count: 201)]
        XCTAssertNil(EndpointPolicy.normalize(nil))
        for input in invalid { XCTAssertNil(EndpointPolicy.normalize(input), input) }
    }

    func testNavigationStaysOnSelectedOrigin() throws {
        let endpoint = try XCTUnwrap(EndpointPolicy.normalize("192.168.1.20"))
        XCTAssertTrue(EndpointPolicy.allows(URL(string: "http://192.168.1.20:8620/api/apps/icon?id=a"), endpoint: endpoint))
        for input in ["http://192.168.1.21:8620/", "https://192.168.1.20:8620/", "http://192.168.1.20/",
                      "http://user@192.168.1.20:8620/", "file:///tmp/a", "javascript:alert(1)", "data:text/html,hello"] {
            XCTAssertFalse(EndpointPolicy.allows(URL(string: input), endpoint: endpoint), input)
        }
        let standard = try XCTUnwrap(EndpointPolicy.normalize("http://localhost"))
        XCTAssertTrue(EndpointPolicy.allows(URL(string: "http://localhost:80/a"), endpoint: standard))
        XCTAssertFalse(EndpointPolicy.allows(nil, endpoint: endpoint))
    }

    func testHealthRequiresBoundedTaraMarker() {
        XCTAssertTrue(HealthProbe.isTara(Data(#"{"ok":true,"app":"tara"}"#.utf8)))
        for input in [#"{"ok":true,"app":"other"}"#, #"{"app":"tara"}"#, #"{"ok":false,"app":"tara"}"#,
                      #"[{"ok":true,"app":"tara"}]"#, "not json", String(repeating: " ", count: 4097)] {
            XCTAssertFalse(HealthProbe.isTara(Data(input.utf8)))
        }
    }
}
