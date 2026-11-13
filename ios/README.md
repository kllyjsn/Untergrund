# UNTERGRUND for iPhone

The iOS app is a native SwiftUI shell around the production UNTERGRUND engine. It keeps the browser engine as the single music runtime while adding the iPhone features a home-screen web app cannot reliably own:

- lock-screen and Control Center metadata, progress, play, pause, previous, and next
- a playback audio session that ignores the silent switch and supports background audio
- native share sheets, haptics, microphone permission, file export, and deep links
- trusted in-app SoundCloud authentication, external-link handoff to Safari, and offline recovery

## Open in Xcode

Requirements: Xcode 16+, iOS 17+, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
brew install xcodegen
cd ios
xcodegen generate
open Untergrund.xcodeproj
```

Select the `Untergrund` target, choose an Apple Developer team under Signing & Capabilities, then run on an iPhone or Simulator. The checked-in bundle identifier is `sh.untergrund.app`; change it if that identifier is unavailable on the selected team.

The app loads `https://www.untergrund.sh/`. For local web development, run the normal server and set the `UNTERGRUND_BASE_URL` environment variable in the Xcode scheme:

```text
http://localhost:8020/
```

## Test

```sh
cd ios
xcodegen generate
xcodebuild \
  -project Untergrund.xcodeproj \
  -scheme Untergrund \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  CODE_SIGNING_ALLOWED=NO \
  test
```

The repository's normal `npm test` also checks the native project definition, property list, asset catalog, icon dimensions, and JavaScript bridge on Linux.

## TestFlight

1. In Xcode, set the Apple Developer team and confirm the bundle identifier.
2. Update `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `project.yml`, then regenerate the project.
3. Choose **Any iOS Device (arm64)**, then **Product → Archive**.
4. In Organizer, choose **Distribute App → App Store Connect → Upload**.
5. In App Store Connect, add the build to an internal TestFlight group.

The first upload also needs the app record, privacy answers, age rating, screenshots, support URL, and review notes. App Store Connect roles with app creation and upload access are sufficient; signing certificates can be managed automatically by Xcode.
