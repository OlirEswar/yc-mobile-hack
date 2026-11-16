# Mobile builds

Cloud machines have no Android or iOS toolchain. Builds run on Revyl's runners
through Capy's `tools.mobile.build`, which uploads `game/` (minus `.godot/`
and `build/`, see `game/.capyignore`) and runs one script there. Both scripts
install the Godot version from `game/GODOT_VERSION` with
`game/tools/install_godot.sh`.

## Android debug APK

Runner: Ubuntu 24.04 arm64 with JDK 17 and the Android SDK. Godot exports
without Gradle using its prebuilt debug template, signed with the committed
debug keystore (`game/tools/mobile/debug.keystore`, standard public password
`android`), so each build installs over the previous one. Architectures:
arm64-v8a and x86_64. Takes about 3 minutes.

```js
await tools.mobile.build({
  action: "start", platform: "android", app: "civ-sim",
  source: {
    type: "workspace", path: "yc-mobile-hack/game",
    commands: ["bash tools/mobile/build_android.sh"],
    output_path: "build/android/civ-sim-debug.apk",
    timeout_seconds: 2400,
  },
});
// then: tools.capy.phone({ action: "install", machine, build_id })  on a Pixel 7
```

## iOS Simulator .app

Runner: macOS on Apple silicon with Xcode. `build_ios_simulator.sh` exports the
Xcode project only (`application/export_project_only` in the iOS preset), then
builds it with `xcodebuild -sdk iphonesimulator` without code signing.

Godot 4.7.2's official `ios.zip` ships the simulator `libgodot.a` with x86_64
objects only, and the cloud simulators need arm64. The script therefore
compiles the arm64 simulator template from the pinned Godot source with scons
(GLES3 only) and swaps it into the exported project. That makes an iOS build
take about 20 minutes; only Xcode's own cache survives between Revyl builds.

```js
await tools.mobile.build({
  action: "start", platform: "ios", app: "civ-sim",
  source: {
    type: "workspace", path: "yc-mobile-hack/game",
    commands: ["bash tools/mobile/build_ios_simulator.sh"],
    output_path: "build/ios/CivSim.app",
    timeout_seconds: 5400,
  },
});
```

The iOS preset carries a placeholder team ID (`0000000000`) because Godot
refuses to export without one; simulator builds are unsigned and ignore it.

## Verifying on a phone

- Attach once and reuse: `tools.capy.phone({ action: "attach", platform: "android", model: "Pixel 7" })`
  or `platform: "ios", model: "iPhone 16"`. Installing onto an asleep phone
  starts a fresh session with the new build.
- The game locks to landscape. Use `tools.capy.phone({ action: "rotate", orientation: "landscape" })`
  so screenshots come out landscape; touch coordinates for
  `tools.capy.computer.on({ machine_id }).screen` stay in the portrait frame
  (1080x2400 on the Pixel 7).
- Android shows a one-time "Viewing full screen" hint; tap Got it.
- Drag pans the map, double tap zooms in 2x. The phone tools drive one pointer,
  so pinch can only be checked by the GUT test (`test_pinch_zooms_in`) or by a
  person on the live phone view.

## Not covered

Release builds need signing: a Play upload keystore for Android, and an Apple
team ID, certificate, and provisioning profile for a device or App Store build.
None of that is in the repo.
