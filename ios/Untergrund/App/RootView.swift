import SwiftUI

struct RootView: View {
    @ObservedObject var model: WebViewModel

    var body: some View {
        ZStack {
            Color(red: 0.11, green: 0.11, blue: 0.12)
                .ignoresSafeArea()

            UntergrundWebView(model: model)
                .ignoresSafeArea()
                .opacity(model.hasLoadedPage ? 1 : 0)

            if let failure = model.failure {
                OfflineView(failure: failure, retry: model.reload)
            } else if !model.hasLoadedPage {
                LaunchView(progress: model.progress)
            }
        }
        .sheet(item: $model.sharePayload) { payload in
            ActivityView(items: payload.items)
                .presentationDetents([.medium, .large])
        }
    }
}

private struct LaunchView: View {
    let progress: Double

    var body: some View {
        VStack(spacing: 22) {
            ZStack {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(Color(red: 1, green: 0.17, blue: 0.17), lineWidth: 4)
                    .frame(width: 62, height: 62)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(Color(red: 1, green: 0.17, blue: 0.17))
                    .frame(width: 18, height: 18)
            }
            Text("UNTERGRUND")
                .font(.system(size: 21, weight: .black, design: .rounded))
                .tracking(3)
            ProgressView(value: max(0.08, progress))
                .tint(Color(red: 1, green: 0.17, blue: 0.17))
                .frame(width: 112)
        }
        .foregroundStyle(.white)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Loading UNTERGRUND")
    }
}

private struct OfflineView: View {
    let failure: WebFailure
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "waveform.slash")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Color(red: 1, green: 0.17, blue: 0.17))
            VStack(spacing: 7) {
                Text(failure.title)
                    .font(.system(size: 22, weight: .bold))
                Text(failure.message)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(Color(red: 1, green: 0.17, blue: 0.17))
        }
        .padding(32)
        .foregroundStyle(.white)
    }
}

struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
