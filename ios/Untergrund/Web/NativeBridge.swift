import Foundation

enum NativeBridge {
    static let handlerName = "untergrund"

    static let bootstrap = """
    (() => {
      window.__UNTERGRUND_IOS__ = true;
      const post = (message) => {
        try { window.webkit.messageHandlers.\(handlerName).postMessage(message); } catch {}
      };
      window.__untergrundNative = {
        post,
        haptic: (style = 'light') => post({ type: 'haptic', style }),
        share: (data = {}) => {
          post({ type: 'share', title: data.title || '', text: data.text || '', url: data.url || '' });
          return Promise.resolve();
        }
      };
      try {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: (data) => window.__untergrundNative.share(data)
        });
        Object.defineProperty(navigator, 'canShare', {
          configurable: true,
          value: (data = {}) => !data.files?.length
        });
      } catch {}
      addEventListener('DOMContentLoaded', () => post({ type: 'ready' }), { once: true });
    })();
    """

    static func command(_ action: String) -> String {
        let escaped = action.replacingOccurrences(of: "'", with: "\\'")
        return """
        window.dispatchEvent(new CustomEvent('untergrund:native-command', {
          detail: { action: '\(escaped)' }
        }));
        """
    }
}
