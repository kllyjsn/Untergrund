import Foundation

struct AppConfiguration {
    static let productionURL = URL(string: "https://www.untergrund.sh/")!

    let baseURL: URL

    static var current: AppConfiguration {
        #if DEBUG
        if let value = ProcessInfo.processInfo.environment["UNTERGRUND_BASE_URL"],
           let url = URL(string: value) {
            return AppConfiguration(baseURL: url)
        }
        #endif
        if let value = Bundle.main.object(forInfoDictionaryKey: "UNTERGRUND_BASE_URL") as? String,
           let url = URL(string: value) {
            return AppConfiguration(baseURL: url)
        }
        return AppConfiguration(baseURL: productionURL)
    }

    var trustedHosts: Set<String> {
        var hosts = ["www.untergrund.sh", "untergrund.sh", "soundcloud.com", "secure.soundcloud.com"]
        if let host = baseURL.host { hosts.insert(host) }
        return Set(hosts)
    }

    func isTrusted(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return trustedHosts.contains(host) || host.hasSuffix(".soundcloud.com")
    }

    func webURL(from incomingURL: URL) -> URL? {
        guard incomingURL.scheme?.lowercased() == "untergrund" else {
            return isTrusted(incomingURL) ? incomingURL : nil
        }
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        let host = incomingURL.host.map { "/\($0)" } ?? ""
        components?.path = host + incomingURL.path
        components?.query = incomingURL.query
        components?.fragment = incomingURL.fragment
        return components?.url
    }
}

enum NavigationDecision: Equatable {
    case allow
    case openExternally
    case reject
}

struct NavigationPolicy {
    let configuration: AppConfiguration

    func decision(for url: URL) -> NavigationDecision {
        guard let scheme = url.scheme?.lowercased() else { return .reject }
        if ["about", "blob", "data"].contains(scheme) { return .allow }
        if ["tel", "mailto", "sms"].contains(scheme) { return .openExternally }
        guard ["http", "https"].contains(scheme) else { return .reject }
        return configuration.isTrusted(url) ? .allow : .openExternally
    }
}
