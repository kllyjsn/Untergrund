#!/usr/bin/env python3
import json
import plistlib
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IOS = ROOT / "ios"
APP = IOS / "Untergrund"
ASSETS = APP / "Resources" / "Assets.xcassets"


def png_size(path: Path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path}: not a PNG"
    width, height = struct.unpack(">II", data[16:24])
    return width, height


required = [
    IOS / "project.yml",
    APP / "App" / "UntergrundApp.swift",
    APP / "App" / "RootView.swift",
    APP / "Audio" / "NowPlayingController.swift",
    APP / "Web" / "WebViewModel.swift",
    IOS / "UntergrundTests" / "NavigationPolicyTests.swift",
]
for path in required:
    assert path.is_file(), f"missing {path.relative_to(ROOT)}"

project = (IOS / "project.yml").read_text()
for value in ["sh.untergrund.app", 'iOS: "17.0"', "UntergrundTests", "Resources/Info.plist"]:
    assert value in project, f"project.yml missing {value}"

with (APP / "Resources" / "Info.plist").open("rb") as file:
    info = plistlib.load(file)
assert info["UNTERGRUND_BASE_URL"] == "https://www.untergrund.sh/"
assert info["NSMicrophoneUsageDescription"]
assert "audio" in info["UIBackgroundModes"]
assert "untergrund" in info["CFBundleURLTypes"][0]["CFBundleURLSchemes"]

for manifest in ASSETS.rglob("Contents.json"):
    data = json.loads(manifest.read_text())
    for image in data.get("images", []):
        filename = image.get("filename")
        if filename:
            assert (manifest.parent / filename).is_file(), f"{manifest}: missing {filename}"

icon_manifest = json.loads((ASSETS / "AppIcon.appiconset" / "Contents.json").read_text())
for image in icon_manifest["images"]:
    expected = round(float(image["size"].split("x")[0]) * float(image["scale"].removesuffix("x")))
    path = ASSETS / "AppIcon.appiconset" / image["filename"]
    assert png_size(path) == (expected, expected), f"{path}: expected {expected}px"
    assert path.read_bytes()[25] == 2, f"{path}: App Store icons must be opaque RGB"

media = (ROOT / "js" / "media-session.js").read_text()
for value in ["untergrund:native-command", "type: 'nowPlaying'", "type: 'playback'", "type: 'position'"]:
    assert value in media, f"native bridge missing {value}"
assert "type: 'audioMode'" in (ROOT / "js" / "sampler.js").read_text()

print("ios project ok")
