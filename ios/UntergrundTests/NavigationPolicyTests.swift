import XCTest
@testable import Untergrund

final class NavigationPolicyTests: XCTestCase {
    private let configuration = AppConfiguration(baseURL: URL(string: "https://www.untergrund.sh/")!)

    func testAllowsUntergrundAndSoundCloud() {
        let policy = NavigationPolicy(configuration: configuration)
        XCTAssertEqual(policy.decision(for: URL(string: "https://www.untergrund.sh/r/live")!), .allow)
        XCTAssertEqual(policy.decision(for: URL(string: "https://secure.soundcloud.com/connect")!), .allow)
    }

    func testSendsOrdinaryExternalLinksToSystemBrowser() {
        let policy = NavigationPolicy(configuration: configuration)
        XCTAssertEqual(policy.decision(for: URL(string: "https://example.com/")!), .openExternally)
        XCTAssertEqual(policy.decision(for: URL(string: "mailto:hello@untergrund.sh")!), .openExternally)
    }

    func testRejectsUnknownSchemes() {
        let policy = NavigationPolicy(configuration: configuration)
        XCTAssertEqual(policy.decision(for: URL(string: "javascript:alert(1)")!), .reject)
    }

    func testDeepLinkBecomesWebRoute() {
        let url = configuration.webURL(from: URL(string: "untergrund://r/warehouse?invite=abc")!)
        XCTAssertEqual(url?.absoluteString, "https://www.untergrund.sh/r/warehouse?invite=abc")
    }
}
