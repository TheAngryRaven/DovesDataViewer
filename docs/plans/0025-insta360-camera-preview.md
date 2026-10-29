# Insta360 camera preview — stream a recording off the camera into the player

> Status: **LANDED (frontend), awaiting the shell's first SDK build.**
> Companion: LapWing plan 0002 + `docs/insta360.md` (the `insta360_*` IPC
> contract, the native plugin, and the build-with-SDK story). Native only —
> the web app is untouched beyond a lazy chunk it never loads.

## Why this exists

The Android app is the place for camera integration (LapWing plan 0001).
The first slice, by the owner's brief: connect to an Insta360 camera, get a
recording into the player **without downloading it**, preview it with the
overlays, and — for 360° footage — let the user point the view somewhere
and lock it. Nothing fancier: no export, no GPS sync, no motion tracking.
The constraint that shaped everything: reuse the existing video machinery.

## What landed

### `src/lib/insta360/`
- `types.ts` — the IPC contract (`Insta360CameraFile`, `ViewPose`, player
  request/info/events).
- `ipc.ts` — thin wrappers over `insta360_*` through the shared lazy Tauri
  loader; `insta360SdkInfo()` never throws and answers `available: false`
  on the web, on the desktop stub, on an Android build without the SDK, and
  on an older shell — the one gate the UI needs.
- `pose.ts` — pure: yaw wrap / pitch+fov clamp, `dragToPose` (a full-width
  drag sweeps the current horizontal FOV, scene follows the finger, vertical
  FOV from the picture's aspect), `pinchToPose` (unused by the UI yet).
- `playerClock.ts` — pure: the playhead the WebView reads synchronously,
  extrapolated between the shell's ~10 Hz reports, snapped on seeks,
  frozen on pause.
- `nativePlayer.ts` — `NativePlayerElement`, the camera stream as a
  `<video>`-shaped object: implements the `VideoSurface` subset
  `useVideoSync` relies on (`currentTime`, `duration`, `paused`,
  `play/pause`, `fastSeek`, the intrinsic size, `muted`, and the
  `loadedmetadata`/`play`/`pause`/`seeked`/`ended`/`error` events) over
  the IPC + a player-event channel. Seeks fire `seeked` when the shell
  confirms or after a 600 ms watchdog, so the scrub pacer can't wedge.

### `useVideoSync`
- `videoRef` is now a `MutableRefObject<VideoSurface | null>` claimed by
  whichever surface mounts — the `<video>` element (callback ref) or the
  native player. The `requestVideoFrameCallback` paths became optional
  (rAF fallback already existed). No sync/offset/scrub logic changed.
- New `loadCameraRecording(file, size)`: opens the native player (waits for
  a real duration if the shell didn't have one yet), builds a one-chunk
  playlist on the MJPEG URL, clears export chunks and the store key (no file
  behind a stream), remembers the sync record by file name. `unloadVideo()`
  drops any source. `state.nativeSource` tells the player what it's showing.
- Any source change (`revokeAllUrls`) closes the stream.

### `VideoPlayer`
- Empty state and toolbar get a *From Insta360 camera* button when the shell
  reports the SDK; the lazy `Insta360ImportDialog` (Wi-Fi name prefix +
  password — `88888888` is the factory default — connect, list newest first
  with a 360° badge, Load; Disconnect ends a stream) sits next to the
  recording picker.
- A camera stream renders as an `<img>` where the `<video>` would be; the
  overlay canvas, rect tracking and toolbar work unchanged. Export is
  disabled for streams (no file to transcode yet); the mute toggle is
  mirrored onto the native player.
- 360° streams get two buttons: point (unlocks `Insta360ViewLayer`, a
  drag surface under the overlays that turns finger deltas into absolute
  poses, one in flight at a time, latest wins) / lock, and reset. Streams
  start locked so a stray touch can't spin the view.

## First hardware test (X4, fw 1.9.21)

Video plays, overlays render, and manual sync works. What the test showed,
and what changed for it:

- Opening a recording is slow: ~27 s for the shell to read the file's
  metadata off the camera, then ~20 s more to the player's first frame.
  With nothing on screen the tap looked ignored and got repeated. The video
  pane now shows a spinner with the phase (`cameraLoadPhase`: reading →
  starting) for the whole load.
- The metadata's duration was 28× the real one (`47051984 ms` vs. the
  player's `1680428 ms`), and the playlist was built from it.
  `loadCameraRecording` now waits for the first rendered frame
  (`NativePlayerElement.whenFirstFrame`, 60 s cap) and builds the playlist
  from the player's own duration.

- 360° dragging jittered: `Insta360ViewLayer` built each step on the pose
  the player last reported (lagging the finger), and the shell turned every
  pose into a separate synthetic swipe plus corrective drags. Steps now
  build on the drag's own target; the shell holds one synthetic finger down
  for the whole drag (LapWing `GestureSynth.Held`).
- The SSID-prefix field's "X4" was a placeholder, so an untouched field
  meant "current Wi-Fi". It is now a real, remembered default
  (`lib/insta360/connectPrefs.ts`).

## Bluetooth connect (no password typed)

Digging the hotspot password out of the camera's settings was the worst
part of the first test. The Insta360 Camera SDK V2 documents a "BLE first,
then Wi-Fi" bootstrap (its guide §2.5): BLE-connect, read
`system.fetchWifiData()` (ssid/pwd, opening the hotspot first if it's off),
join with the system Wi-Fi API, then connect over Wi-Fi as before. The
shell runs all of it (LapWing `insta360_ble_scan` / `insta360_ble_connect`);
the credentials never reach the WebView. The dialog's main path is now
*Find cameras* → tap a camera; the typed name/password form is a fallback
behind a link. A first scan fails with `permission: …` while Android asks
for Nearby-devices access (classified as `permission` by
`lib/loggers/errors.ts`); the user scans again.

## Deliberate limits

- Preview only: no export, no download, no GPS sync; pose isn't persisted
  and a stream isn't restored on reopen (the sync offset is, by file name).
- No pinch/zoom in the UI yet (`pinchToPose` is ready).
- Wi-Fi only; the SDK's USB/BLE transports are in the contract only.

## Verification

- Unit: `pose.test.ts`, `playerClock.test.ts`, `nativePlayer.test.ts`
  (mocked bridge: request shape, play/pause clock, status resync, seek
  hold-off + confirmation + watchdog, ended/error, muted, close-while-opening).
  Full suite, `tsc -b`, eslint, `vite build` green.
- On device (owner, with the SDK build): connect → list → load → overlays
  on the stream → lock sync + offset → 360° point/lock/reset; see the
  checklist in LapWing `docs/insta360.md`.
