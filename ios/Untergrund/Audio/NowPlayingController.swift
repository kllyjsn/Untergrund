import AVFAudio
import MediaPlayer
import UIKit

@MainActor
final class NowPlayingController {
    var sendCommand: ((String) -> Void)?

    private let commandCenter = MPRemoteCommandCenter.shared()
    private var info: [String: Any] = [:]

    init() {
        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.sendCommand?("play")
            return .success
        }
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.sendCommand?("pause")
            return .success
        }
        commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.sendCommand?("nexttrack")
            return .success
        }
        commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.sendCommand?("previoustrack")
            return .success
        }
    }

    func updateMetadata(title: String, artist: String, album: String) {
        guard !title.isEmpty else {
            info.removeAll()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = artist
        info[MPMediaItemPropertyAlbumTitle] = album
        if let image = UIImage(named: "NowPlayingArtwork") {
            info[MPMediaItemPropertyArtwork] = Self.artwork(for: image)
        }
        publish()
    }

    func updatePlayback(state: String) {
        let isPlaying = state == "playing"
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        if isPlaying {
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        publish()
    }

    func updatePosition(duration: Double, position: Double) {
        guard duration > 0 else {
            info.removeValue(forKey: MPMediaItemPropertyPlaybackDuration)
            info.removeValue(forKey: MPNowPlayingInfoPropertyElapsedPlaybackTime)
            publish()
            return
        }
        info[MPMediaItemPropertyPlaybackDuration] = duration
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = min(duration, max(0, position))
        publish()
    }

    func updateActions(_ actions: [String]) {
        let available = Set(actions)
        commandCenter.playCommand.isEnabled = available.contains("play")
        commandCenter.pauseCommand.isEnabled = available.contains("pause")
        commandCenter.nextTrackCommand.isEnabled = available.contains("nexttrack")
        commandCenter.previousTrackCommand.isEnabled = available.contains("previoustrack")
    }

    private nonisolated static func artwork(for image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }

    private func publish() {
        guard !info.isEmpty else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
