import AVFAudio
import Combine
import SafariServices
import SwiftUI
import UIKit
import WebKit

struct WebFailure: Equatable {
    let title: String
    let message: String
}

struct SharePayload: Identifiable {
    let id = UUID()
    let title: String
    let text: String
    let url: URL?
    let fileURL: URL?

    var items: [Any] {
        var values: [Any] = []
        if !text.isEmpty { values.append(text) }
        if let url { values.append(url) }
        if let fileURL { values.append(fileURL) }
        if values.isEmpty, !title.isEmpty { values.append(title) }
        return values
    }
}

@MainActor
final class WebViewModel: NSObject, ObservableObject {
    @Published private(set) var progress = 0.08
    @Published private(set) var hasLoadedPage = false
    @Published private(set) var failure: WebFailure?
    @Published var sharePayload: SharePayload?

    let webView: WKWebView
    private let configuration: AppConfiguration
    private let navigationPolicy: NavigationPolicy
    private let nowPlaying = NowPlayingController()
    private var observations: [NSKeyValueObservation] = []
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    override init() {
        let appConfiguration = AppConfiguration.current
        configuration = appConfiguration
        navigationPolicy = NavigationPolicy(configuration: appConfiguration)

        let contentController = WKUserContentController()
        contentController.addUserScript(WKUserScript(
            source: NativeBridge.bootstrap,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.userContentController = contentController
        webConfiguration.websiteDataStore = .default()
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.mediaTypesRequiringUserActionForPlayback = []
        webConfiguration.preferences.javaScriptCanOpenWindowsAutomatically = true
        webConfiguration.defaultWebpagePreferences.allowsContentJavaScript = true

        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        super.init()

        contentController.add(WeakMessageHandler(self), name: NativeBridge.handlerName)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor

        observations = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
                Task { @MainActor in self?.progress = max(0.08, view.estimatedProgress) }
            }
        ]

        nowPlaying.sendCommand = { [weak self] action in
            self?.webView.evaluateJavaScript(NativeBridge.command(action))
        }
        load(configuration.baseURL)
    }

    func reload() {
        failure = nil
        hasLoadedPage = false
        if let url = webView.url {
            webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        } else {
            load(configuration.baseURL)
        }
    }

    func open(_ incomingURL: URL) {
        guard let url = configuration.webURL(from: incomingURL) else { return }
        failure = nil
        webView.load(URLRequest(url: url))
    }

    private func load(_ url: URL) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        request.cachePolicy = .useProtocolCachePolicy
        webView.load(request)
    }

    private func handle(_ body: Any, originHost: String) {
        guard configuration.trustedHosts.contains(originHost) || originHost.hasSuffix(".soundcloud.com"),
              let message = body as? [String: Any],
              let type = message["type"] as? String else { return }

        switch type {
        case "ready":
            failure = nil
        case "nowPlaying":
            nowPlaying.updateMetadata(
                title: message["title"] as? String ?? "",
                artist: message["artist"] as? String ?? "UNTERGRUND",
                album: message["album"] as? String ?? "UNTERGRUND"
            )
        case "playback":
            nowPlaying.updatePlayback(state: message["state"] as? String ?? "paused")
        case "position":
            nowPlaying.updatePosition(
                duration: message["duration"] as? Double ?? 0,
                position: message["position"] as? Double ?? 0
            )
        case "actions":
            nowPlaying.updateActions(message["actions"] as? [String] ?? [])
        case "audioMode":
            configureAudioSession(recording: message["recording"] as? Bool ?? false)
        case "share":
            let rawURL = message["url"] as? String ?? ""
            sharePayload = SharePayload(
                title: message["title"] as? String ?? "",
                text: message["text"] as? String ?? "",
                url: URL(string: rawURL),
                fileURL: nil
            )
        case "haptic":
            haptic(message["style"] as? String ?? "light")
        default:
            break
        }
    }

    private func haptic(_ style: String) {
        let feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle
        switch style {
        case "heavy": feedbackStyle = .heavy
        case "medium": feedbackStyle = .medium
        case "rigid": feedbackStyle = .rigid
        case "soft": feedbackStyle = .soft
        default: feedbackStyle = .light
        }
        UIImpactFeedbackGenerator(style: feedbackStyle).impactOccurred()
    }

    private func configureAudioSession(recording: Bool) {
        let session = AVAudioSession.sharedInstance()
        if recording {
            try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        } else {
            try? session.setCategory(.playback, mode: .default)
        }
        try? session.setActive(true)
    }

    private func presentExternal(_ url: URL) {
        UIApplication.shared.open(url)
    }

    private func showFailure(_ error: Error) {
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        failure = WebFailure(
            title: "Can’t reach UNTERGRUND",
            message: "Check your connection and try again."
        )
    }
}

extension WebViewModel: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        handle(message.body, originHost: message.frameInfo.securityOrigin.host.lowercased())
    }
}

extension WebViewModel: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failure = nil
        hasLoadedPage = true
        progress = 1
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if !hasLoadedPage { showFailure(error) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        switch navigationPolicy.decision(for: url) {
        case .allow:
            decisionHandler(.allow)
        case .openExternally:
            presentExternal(url)
            decisionHandler(.cancel)
        case .reject:
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }
}

extension WebViewModel: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if navigationPolicy.decision(for: url) == .allow {
            webView.load(navigationAction.request)
        } else {
            presentExternal(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let trusted = configuration.trustedHosts.contains(origin.host.lowercased())
        decisionHandler(trusted && type == .microphone ? .grant : .prompt)
    }
}

extension WebViewModel: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let cleanName = suggestedFilename.isEmpty ? "UNTERGRUND.wav" : suggestedFilename
        let destination = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(UUID().uuidString)-\(cleanName)")
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let fileURL = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        sharePayload = SharePayload(title: fileURL.lastPathComponent, text: "", url: nil, fileURL: fileURL)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        failure = WebFailure(title: "Export failed", message: "The file could not be prepared. Try exporting again.")
    }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?

    init(_ delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}
