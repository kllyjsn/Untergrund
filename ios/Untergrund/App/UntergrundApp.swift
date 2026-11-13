import SwiftUI

@main
struct UntergrundApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var webViewModel = WebViewModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: webViewModel)
                .preferredColorScheme(.dark)
                .onOpenURL { webViewModel.open($0) }
        }
    }
}
