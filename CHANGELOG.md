# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> This changelog was introduced at the `1.5.0` release. An early `V1.0.0` tag
> exists from March 2026, but predates the changelog; no per-version records
> were kept between it and `1.5.0`. The `1.5.0` entry below is reconstructed
> from git history and grouped by theme rather than exhaustive per-commit
> detail.

## [2.6.0] - unreleased

### Added
- **Earn free cloud storage by contributing tracks.** When you submit tracks to
  the community database while signed in, your contribution is now linked to your
  account — and the submit screen shows a note that signed-in contributions earn
  free cloud storage. Submitting without an account still works exactly as before.
  The home-screen **Manage tracks** card and the **Submit to DB** button now show
  a 🎁 reminder of the perk too.
- **Admin: user management.** A new **Users** tab in the admin panel lists every
  account with its email/display name, plan, storage used, and number of track
  contributions. Click a user to see details and **grant them free months of
  premium** (or remove the grant). Comped premium expires automatically when the
  granted months run out.
- **Admin: see who submitted a track.** The Submissions tab now shows the
  contributor's account name (or "Anonymous") alongside the existing IP/date.
- **Complimentary plan badge.** If you've been granted free premium, your Profile
  now shows a "Complimentary" badge and how long it lasts — and hides the Stripe
  billing buttons (there's no paid subscription to manage).
- **Setup history.** Each setup in the Garage now has a **history** (book) icon
  that opens a full-panel timeline of every saved revision. It starts with the
  original setup shown in full, then lists each later revision as a **diff** —
  only the values that changed, coloured **green when a number went up** and
  **red when it went down** vs the previous revision (with a per-revision toggle
  to show the full setup instead). Every revision shows the **fastest lap** run
  on it, the revision holding the overall fastest lap is **highlighted**, and the
  history is **filterable by kart and course** — when unfiltered, each revision
  shows a bubble for the kart/course where its fastest lap was set.
- **Tools on the home screen.** A new **Tools** tile on the landing page opens the
  trackside tools (the seat-position visualizer and more) in a full-screen panel —
  no datalog needed.
- **Datalogger (early/experimental).** A new tool that turns your phone's GPS into
  a live lap timer: a big delta to your best lap (red when you're slower, green
  when faster), current/best/last/optimal lap times, speed, and a **Lap Times**
  list with major-sector splits. It starts recording once you're moving above
  5 mph and saves the session as a `.dovep` log to your files when you end it
  (auto-ends after 5 minutes stopped, or tap **End**) — then opens and reviews
  exactly like any other log. Early days: the timing and UI will be refined in
  upcoming updates.
- **Translations / multi-language support (foundation).** The app now has an
  internationalization system (built on i18next) with a **Language** picker in
  Settings. It auto-detects your browser language on first run and ships
  **English, Spanish, French, German, Italian, Brazilian Portuguese and
  Japanese**. Non-English languages start as machine translations and will be
  hand-tuned over time. Everything stays fully offline — each language loads on
  demand and is cached by the app. Translated so far: the home screen, the
  Settings panel, the **core in-session UI** (view tabs, the lap-times table, and
  the Snapshots, Overlays and crop-to-sector controls), and the **live analysis
  views** — the race-line map and the pro graph view (legends, the graph picker,
  the G-G diagram, and the info panel), and the **video** player and overlay/
  export tools (player controls, the export dialog, overlay settings, and the
  overlay widget labels), and most of the **Garage drawer** — Files & Vehicles
  (the drawer/device tab chrome, the file browser, the vehicle + engine manager)
  plus **Setups & Notes** (the setup editor, the vehicle-type builder, session
  notes, and the read-only setup table) and **Device** (device settings, the
  firmware updater, and the track-sync manager). The **weather** panel and METAR
  lookup dialog are also translated now, along with the **track tools** — the
  track/course editor and manager (including the visual line/outline editor and
  the auto-detect prompt) and the community track-submission flow, and the
  **Cloud Sync** Profile panels — Account, Lap snapshots, Cloud logs, and Data &
  privacy, plus the per-file cloud sync/delete toggles and the background
  sync/export status messages, and the **Tools** tab — the tool picker and the
  kart seat-position visualizer, and the **account pages** — sign in, create
  account, forgot/reset password, the sign-in callback, and the **plans &
  pricing** section on the sign-up page — and the home-screen
  **file drop zone** ("Open a datalog") plus the **About**, **Supported Files**,
  **Credits**, **Contact** and **browser-compatibility** dialogs, and the entire
  **admin panel** (every tab — Messages, Submissions, Tracks, Courses, Tools and
  Banned IPs). With this, the whole app is translated.
  (Open-source library names and GitHub link names stay in English by design, as
  do the legal pages.)
- **Log type bubble in the file browser.** Each session row (shown by date/time)
  now carries a small pill with the log's format — Dove, Dovex, XRK, XRZ,
  iRacing, VBO, MoTeC, UBX, NMEA, CSV, … — derived from the file's extension, so
  you can tell at a glance what kind of log each one is. Appears on local and
  cloud rows and in the Profile → Cloud logs list.

### Changed
- **Track manager tabs reordered.** In the track/course manager, the **Tracks**
  tab now sits on the left and **Courses** on the right, and opening **Manage
  tracks** from the home screen now starts on the **Tracks** tab — so you pick a
  track before drilling into its courses, which is a clearer starting point. (In a
  loaded session it still opens on Courses, since you already have a track.)
- **Sample data is now just a normal log.** The bundled sample session lives in
  your file browser as an ordinary file named **"SAMPLE - Tillotson 225rs"**, and
  the home-screen **Load sample data** button simply opens it like any other log —
  no more special-case sample handling and its rough edges. A new **Show sample
  files** toggle in Settings (on by default) hides it from the browser — and the
  home-screen sample tile — if you'd rather not see it. The sample always shows as
  cloud-synced and can't be uploaded, so it never eats into your cloud storage.
  When the sample is your *only* file, the toggle stays locked on so you can never
  hide your only way back into the app.
- **Weather is cached per session.** Once a session's weather has been looked up,
  it's saved on your device — a session's date never changes, so its weather is
  fixed. Reopening that session shows the saved conditions instantly and no longer
  re-queries the weather station / service every time. The cache stays on your
  device (it isn't cloud-synced — there's no point re-uploading data the next
  device can look up for free), and the home-screen **Local Weather** check still
  fetches live, current conditions as before.
- **Landing page UX overhaul** — the home screen is simpler and friendlier. The
  cluster of small buttons that used to live inside the file dropzone is gone;
  importing a file is now a single large drag-and-drop / click-to-browse zone,
  and every other action (load sample data, browse saved files, download from
  the logger over Bluetooth, manage tracks, build your own logger) is a big,
  clearly-labelled tile. Pricing is no longer shown on the landing page — it
  lives on the registration page where you pick a plan. Colors and design tokens
  are unchanged; this is a layout/usability pass only.
- **Mobile garage & header polish.** The Garage/Device drawer now covers the
  full screen on mobile (it stays at half width on larger screens) so it's
  easier to use on a phone. In the loaded-session header, the track/course label
  and edit button are consolidated into a single course control — now using a
  route icon (at every screen size) with the current track : course as its label
  from tablet up.

### Fixed
- **Datalogger looked like it didn't recognise the track while parked.** Sitting
  still at a known venue, the tool shows a plain speedometer (lap timing only arms
  once you're moving above 5 mph) — but it gave no sign the track had been
  detected, so it was indistinguishable from the genuine "no tracks found nearby"
  state. The waiting speedometer now names the recognised track (e.g. "Orlando
  Kart Center detected nearby") when you're near one, so it's clear the track list
  loaded and you're just waiting to start moving.
- **Start/finish line couldn't be placed on a new track/course.** After the
  sector-editor overhaul, a brand-new course had no coordinates for its
  start/finish line, so it never appeared on the map and there was no way to
  create or drag it (it effectively sat at null-island). The start/finish line is
  now dropped into the center of the chosen map view — automatically once the
  venue is known (a GPS-loaded session, or right after a location search / "use
  my location") — and the start/finish row gains a **reset** button that
  re-drops it in the current view so it can always be (re)placed and then dragged
  into position, just like the other sector lines. Tapping the start/finish row
  itself also drops the line when none exists yet, so there's nothing to hunt for.
- **Track editor back/close buttons.** The course editor had a redundant second
  close button, and "Back to Selection" left the edited course open underneath —
  so reopening Manage jumped straight back into that course. The extra close
  button is gone, "Back to Selection" is now just **Back** and steps back one
  level at a time (course editor → course list → selection) without stranding the
  previous course.
- **Track editor map was broken on the home screen.** Opening the satellite map
  (Add/Edit course) from the landing-page track manager — with no session loaded
  — rendered the map with scattered tiles and off-centre zoom. Leaflet's
  stylesheet was only pulled in by the in-session maps (`RaceLineView`/`MiniMap`),
  which don't mount on the landing page, so the editor map ran without it and its
  tiles fell back to normal document flow. The editor map now imports
  `leaflet/dist/leaflet.css` itself, so it renders correctly with or without a
  loaded session.
- **Pro-mode panel resizing on touch.** Dragging a resizable divider (the
  left/right split and the InfoBox/MiniMap split in pro mode, plus the video
  panel) would stop after only a few pixels on touchscreens. The handle's
  invisible grab strip was only a few pixels wide while the drag-start margin
  extended over the neighbouring chart/map — so a finger landing just off the
  divider started the resize on an element without `touch-action: none`, and the
  browser reclaimed the gesture as a scroll. The grab strip is now wider and the
  start margin is aligned to it, so touch drags track all the way.

## [2.5.0] - 2026-06-13

### Added
- **Tools tab** — a new main-view tab to the right of Coach, contributed by a
  new first-party `tools` plugin. The tab self-gates like Coach (it shows only
  when a plugin contributes to the new `tools` panel slot) and opens on a
  picker of tools — icon + one-line description — that you click into.
- **Kart seat position visualizer** — the first tool (tagged *super
  experimental* on its picker card): a side-view rigid-body
  statics model showing how a fore/aft seat slide (±1", 1/16" detents) and a
  seat tilt (±5°, or rear-mount mm) shift front/rear weight distribution and
  CoG height relative to a user-set zero point. A stick-figure driver with
  feet-on-pedals knee IK makes the leg-coupling model visible. Readouts:
  signed Δrear %, per-axle weight in lb/kg, CoG height change, local
  sensitivities (%/inch and %/degree), and a 1.5 g lateral-transfer indicator
  (rigid-frame approximation). An advanced panel tunes the leg-coupling factor
  and seat/driver geometry, and a corner-scale calibration flow anchors the
  baseline to your kart and fits the leg coupling from a measured seat slide.
  Fully offline; settings persist in the tools plugin's own IndexedDB store.
- **"Unlimited" course sectors.** A course is no longer limited to three fixed
  sectors. The course editor now shows an ordered, drag-to-reorder sector list
  below the map: add sectors, mark exactly three (start/finish + two) as **Major
  sectors**, and group sub-sectors under each major. Up to 25 timing lines per
  course. Start/finish, major, and sub-sector lines are drawn on the race-line
  map in three distinct colors.
- **Per-sector optimal lap + Full lap-table view.** The optimal (ideal) lap is
  now computed from the best time in *every* sector, not just the three majors.
  The lap-times list has a **Simple/Full** toggle — Full shows one column per
  fine-grained sector (zebra-striped by major group, horizontally scrollable).
  In Full view a colored **"S# Sum"** column precedes each major sector's
  columns, showing that major's running total (the S1/S2/S3 rollup) per lap with
  the fastest sum highlighted; a **Sector sums** toggle (default on) shows or
  hides them.
- **Crop to a sector.** The data-crop bar on the Simple and Pro views now pairs
  the range slider with a sector dropdown — pick a sector to snap the view to
  that section of the selected lap.

### Changed
- **The main tab bar is icons-only on phones.** Every view tab (Simple, Pro,
  Lap Times, Labs, Coach, Tools) and the Simple-view Overlay toggle now show
  just their icon at phone widths; labels return at tablet width and up.
- The logger track export is unchanged on the wire: only the three major sectors
  (start/finish + two) are uploaded to the DovesDataLogger, so sub-sectors are an
  app-only refinement. Track JSON, community submissions, and the admin database
  carry the full ordered list alongside the legacy two-sector mirror.
- Removed the per-lap "Map" overlay toggle column from the lap-times list
  (overlays are still controlled from the header Overlays menu).

### Fixed
- **Pro-mode mini-map no longer re-centers too early.** The camera held the
  position arrow inside the middle half of the view, so it snapped back to
  center while the cursor was still well within the visible map. It now re-centers
  only once the arrow's edge actually reaches the viewport border, so the map
  stays put while the cursor crosses most of it.
- **New sectors drop in the middle of the current map view.** Adding a sector
  in the course editor previously dropped the line near start/finish (often
  off-screen if you'd panned away). It now lands in the center of whatever
  you're looking at, without moving the map.
- **Sector lines are much easier to see in the course editor.** Unselected
  timing lines were thin and faint; they're now drawn noticeably thicker (and
  the selected line thicker still), so all the lines stand out against the
  satellite imagery.

## [2.4.0] - 2026-6-12

### Fixed
- **UBX session start time was shifted by the browser's time zone.** The
  parser now builds the session date from the receiver's UTC fields with
  `Date.UTC` (matching the NMEA parser), so file-browser names and the weather
  lookup hour are no longer off by the local UTC offset.
- **Course auto-detection now enforces the documented 25% length tolerance.**
  A course whose known length differs from the driven lap distance by more
  than 25% is rejected (waypoint-mode fallback) instead of being tagged onto
  the session with the wrong sector lines. Courses without a stored length
  remain eligible.
- **Alfano time units are decided once per file.** The old per-row heuristic
  flipped a millisecond-based time column to seconds for the first 100 s, then
  collapsed — time ran backwards and a fake day was added. The unit is now
  detected from the whole column (value range + median row step).
- **Native g-force channels are never silently clobbered or dropped.** AiM CSV
  and MoTeC logger-reported lateral/longitudinal g now land on the dedicated
  native channels and coexist with the GPS-derived primary pair (like Alfano,
  VBO, and iRacing already did). When a file supplies only one g axis, that
  axis is preserved as a native channel instead of being overwritten by the
  GPS derivation — and the missing axis is now derived instead of absent
  (previously a MoTeC file with only lateral g got no longitudinal g at all).
  Same fix applied to AiM XRK imports.

### Changed
- **Playback now runs at real time.** The playback loop no longer tears itself
  down and re-anchors its clock on every cursor tick, so high-rate (60 Hz)
  data plays at full speed instead of capping at half the display rate. The
  playback Hz readout is also no longer recomputed (a full sort of the visible
  window) on every render.
- **MiniMap follow-cam stopped fighting itself.** The Pro-mode map re-centers
  only when the position arrow leaves the middle of the view, without
  animation — instead of issuing an animated pan every tick that perpetually
  interrupted itself.
- **Video export no longer holds the whole MP4 in memory.** Long exports
  (estimated > 350 MB — e.g. 20 min at high quality ≈ 2.2 GB) stream the
  output in ~16 MB chunks (fragmented MP4) instead of one giant buffer, which
  was a guaranteed out-of-memory crash on mobile. Both the video and audio
  encoders now run with bounded queues (backpressure), so encoding can't
  buffer unbounded raw frames when the encoder falls behind.
- **~40% smaller landing page.** The initial payload dropped from ~1.13 MB raw
  / ~334 kB gzip to ~684 kB / ~207 kB: the map stack (Leaflet + the Simple
  view) now loads when a session opens rather than up front, and the Supabase
  client is completely off the eager path — offline-first builds (cloud/admin
  flags off) never download it at all, and flag-on builds load it off the
  critical path.

### Changed
- **Map heatmap rendering rebuilt for large sessions.** The race-line speed
  heatmap (Simple view and the Pro MiniMap) now renders as ~20 canvas-drawn
  color-bucket polylines instead of one SVG DOM element per GPS segment, which
  could attempt tens of thousands of DOM nodes and freeze the tab when a long
  range was selected. Dragging the range slider also no longer re-fits the map
  view on every movement.
- **Playback is dramatically cheaper.** The playback cursor was split out of
  the shared session state into its own context, so a tick only re-renders the
  components that track it (charts, maps, video overlays) instead of every
  view. The analysis charts now draw on two stacked canvases — a static layer
  (grid, lines, overlays) and a cursor layer — so moving the cursor costs a
  clear + a line + a tooltip instead of a full chart redraw, and dense series
  are decimated to per-pixel min/max pairs before stroking. The map position
  arrow is now moved/rotated in place instead of being recreated every tick.
- The pace chart's area fill is now tinted by sign per region (green where
  ahead of the reference, red where behind) instead of switching the entire
  fill color based on the value at the cursor.

### Fixed
- **VBO (Racelogic VBOX) time parsing.** The `time` column is now decoded as
  the spec's packed UTC `HHMMSS.SS` by digit position. Previously, any session
  before 10:00 UTC was misread as plain seconds-since-midnight (injecting ~40
  phantom seconds at every minute boundary and corrupting lap times), and
  2-decimal times at/after `100000.00` were mis-aligned, making time run
  backwards at 10-minute boundaries.
- **VBO (Racelogic VBOX) coordinates.** Standard Racelogic exports store
  lat/long as *total decimal minutes* with longitude positive **west**; the
  parser now detects this per file and converts correctly, instead of
  misreading the values as `DDDMM.MMMMM` (which placed the race line ~2,300 km
  away and mirrored hemispheres). RaceBox-style signed decimal-degree exports
  still parse as before.
- **AiM CSV speed units.** The km/h vs m/s vs mph decision now comes from the
  file's explicit unit label (the RaceStudio units row, or a bracketed unit in
  the header) with a whole-file statistic as fallback. Previously it was
  decided from the first GPS-valid row alone, so a session that started slowly
  (rolling out of the pits) had every speed multiplied by 3.6.
- **Charts no longer crash on very long sessions.** Min/max computations in
  the speed/telemetry charts and the heatmap bounds used argument spreading,
  which threw `RangeError: Maximum call stack size exceeded` above ~65k
  samples (e.g. viewing All Laps on a 2-hour 20 Hz session) and blanked the
  chart. They now use plain loops.

## [2.3.1] - 2026-06-10

### Changed
- **Home page reshuffle.** The "Try it out!" sample-data panel now sits at the
  top of the page (above the file import) and the "Build your own datalogger"
  card moved below it, so new visitors see how to try the viewer first.
- **Contact button stands out.** The header's Contact button is now a filled
  primary button instead of a muted outline, so it's easier to find.
- **About dialog mentions OTA.** The feature list in the About dialog now
  includes over-the-air firmware updates for the DovesDataLogger.

## [2.3.0] - 2026-06-08

### Added
- **Firmware updates over Bluetooth.** Update your DovesDataLogger's firmware
  straight from the **Device → Settings** tab — no desktop tools, no cables, no
  taking the device apart. It shows the installed firmware version with a **Check
  for updates** button; when a newer build is available, a confirmation dialog
  (battery / don't-power-off warnings) runs it: download the image, verify it
  against the published checksum, upload it to the logger's SD card, and the device
  re-checks the checksum, installs it, and reboots into the new firmware. The image
  is **CRC-32 verified at every hop** — publisher → download → device control
  channel → on-device file — so a corrupt or wrong-variant transfer can never be
  flashed. You get a **"Flash complete"** prompt to reconnect when it's done.
  Fetching firmware needs a connection; everything else runs in-browser. Beta
  builds pull from a separate beta firmware channel and always offer the update for
  testing.

### Changed
- **Clearer plans & pricing cards.** The plan cards now lead with bold,
  larger-text titles — **Just the App** (offline) and **Cloud Access** (the
  online plans) — with the descriptive subtitles dropped. Instead of two cards
  both titled "Free" showing "$0" (which read as duplicates and tripped up
  screen-reader/accessibility users), the two no-cost cards now show the word
  **Free** in place of a price, and only the paid plan shows an actual price.
  Storage lines read "cloud storage for datalogs" to make clear what the quota
  covers.

### Added
- **Independent imperial/metric unit toggles.** Settings now has three separate
  unit switches instead of just one speed toggle: **Speed** (MPH ⇄ KPH),
  **Distance** (ft/mi ⇄ m/km — track lengths, lap/chart distance axis, the
  range-crop labels, and meters-based telemetry channels like Distance &
  Altitude in the graphs and video overlays), and **Weather**
  (°F/mph/inHg/ft ⇄ °C/(km/h)/hPa/m —
  temperature, dew point, wind, pressure, and density/pressure altitude). Each is
  app-wide and remembered per device; all default to imperial.
- **Firmware updates over Bluetooth.** The Device → Settings tab now shows your
  logger's installed firmware version with a **Check for updates** button. When a
  newer build is available for your device, a confirmation dialog (battery /
  don't-power-off warnings) updates it over BLE — download, upload to the logger
  (checksum-verified both ways), then the device installs it and reboots, with the
  app auto-disconnecting when done. No desktop tools needed. Fetching the firmware
  needs a connection; everything else runs in-browser. On beta/preview builds the
  version check is bypassed so the update always pushes through for testing (the
  confirmation dialog says so).

## [2.2.2] - 2026-06-05

### Added
- **iRacing telemetry (`.ibt`) import.** You can now drop iRacing's native binary
  telemetry file straight into the viewer — no third-party conversion to CSV or
  MoTeC needed. The `.ibt` is parsed directly (in-browser, offline) into the same
  GPS-first session as every other format: position/speed/altitude drive the map
  and laps, with throttle, brake, gear, steering, RPM, water/oil temp and native
  lateral/longitudinal g available as channels. It's also listed in the
  **Supported Files** dialog (under the AiM binary format).

### Fixed
- **AiM RaceStudio 3 CSV files now import.** RS3 exports (e.g. MyChron via Race
  Studio 3) use space-delimited channel names (`GPS Speed`) and put the channel
  header ~15 rows below the metadata, so they were neither detected nor parsed as
  AiM — and the broad Alfano detector claimed them and then failed, leaving the
  file unable to load at all. The AiM parser now recognizes RaceStudio's
  `AiM CSV File` signature, matches space- and underscore-delimited channel names
  alike, and scans deep enough to find the header; the format router gives an
  AiM-signed file precedence over Alfano.
- **AiM sessions now carry their real date.** The AiM parser reads the `Date`/
  `Time` rows from the RaceStudio metadata, so AiM imports get a proper session
  start time — used for the historical-weather lookup and the file-browser
  session naming (previously these files had no date and fell back to import
  time). Unparseable/locale-specific dates degrade gracefully to no date rather
  than failing the import.

## [2.2.1] - 2026-06-05

### Added
- **Pick the satellite imagery date in the track editor.** The visual track
  editor's satellite map now has the same Esri Wayback date picker as the
  race-line map, so you can step the basemap back to a cloud-free capture while
  placing start/finish and sector lines (online-only, lazy-loaded).
- **Generate a track outline with no laps.** When you create a fresh track right
  after loading a file from a brand-new venue, there may be no detected laps to
  generate the outline from. The "Generate" tool now offers a **Whole session**
  option that builds the outline straight from the full GPS trace, so you don't
  have to come back later once a course exists. This is also wired into the
  **post-import "Create Track" prompt** (the dialog that appears when no known
  track matches / waypoint timing) — it now carries the session's laps and GPS
  through, so the Generate tool and the drawn outline both work while you're
  first setting the track up.
- **On-screen debug console for mobile.** Load the app with `?dbg=true` to show a
  bottom overlay that mirrors `console.*` output plus uncaught errors and promise
  rejections, with copy/clear/collapse controls. Phones and installed PWAs have
  no dev-tools console, so this makes otherwise-invisible runtime errors readable
  on-device. The flag persists (set `?dbg=false` to turn it off) and the overlay
  renders nothing unless enabled.

### Fixed
- **New tracks now apply immediately.** Creating a track/course while a session
  is loaded re-processes the current file against it right away (laps recompute)
  instead of needing a file reload, and the new track shows up in the track
  selection dropdown without a page refresh. Editing the active session's course
  (e.g. nudging its start/finish line) likewise re-processes immediately.
- **Generate outline now actually works on real telemetry.** The polyline
  resampler accumulated distance incorrectly across segments, so a dense GPS
  trace — where each sample is ~1 m apart, well under the 5 m outline spacing —
  collapsed to a single point and generated nothing (no line, nothing saved, no
  thumbnail). It now accumulates arc length across short segments, so generating
  an outline from a lap or the whole session produces a proper polyline.
- **Outline generation now reports failures.** A genuinely too-short/stationary
  trace (or an unexpected error) now shows a clear toast instead of silently
  doing nothing, and logs details to the debug console (`?dbg=true`).

## [2.2.0] - 2026-06-04

### Added
- **Worldwide weather.** Session + local weather now work outside the US. The
  precise US path is unchanged (nearest NWS/ASOS station → historical METAR), but
  when there's no US station (e.g. a session in Europe) it falls back to
  [Open-Meteo](https://open-meteo.com)'s free, keyless, global historical
  reanalysis by lat/lon — so temperature, humidity, pressure, density altitude,
  and wind resolve anywhere. The source is shown in the widget ("Open-Meteo") and
  cached per session like the station lookup.
- **Pick the satellite imagery date (dodge clouds).** The default Esri satellite
  basemap is a single best-available mosaic, so whatever clouds or seasonal cover
  were in that capture are baked in. The race-line map's satellite view now has a
  date picker (powered by Esri Wayback) to step back to an earlier, cloud-free
  capture of the same track. Online-only and lazy-loaded — it never runs for
  offline users or anyone on the default imagery.
- **Native AiM `.xrk` / `.xrz` import.** MyChron / SoloDL binary logs can now be
  opened directly — drag in a `.xrk` (or zlib-compressed `.xrz`) and it flows
  through the normal analysis/plot pipeline like any other format, including as a
  **reference lap or multi-lap overlay** and for lap snapshots. Parsing runs
  **entirely client-side** by [libxrk](https://github.com/m3rlin45/libxrk)'s
  pure-Rust core **compiled to a ~200 KB WebAssembly module** (no Pyodide/Python),
  in a Web Worker so a large session never freezes the UI. It's **fully offline**
  (the wasm is precached) and fast — a typical session parses in tens to a couple
  hundred milliseconds. Import progress (load → parse → align) is shown inline.
- **Full-screen loading overlay on file open.** Loading a datalog now dims the
  screen with a spinner while it parses — automatic for imports, file-manager
  reopens, and cloud-file opens. Fast formats finish instantly (you won't see
  it); slow ones — chiefly the new AiM XRK path — show a live status message so
  it's clear the app is working, not stuck.

### Fixed
- **Session date/time on untagged logs.** A session's start time is now recorded
  on import even when its track isn't in the database yet (common for AiM XRK
  logs from new venues), so the file browser shows the proper date/time name
  instead of the raw filename, and the weather lookup has a timestamp to work
  with. AiM XRK's separate log-date + log-time fields are combined into a real
  timestamp (parsed explicitly so it works on Safari/iOS too).
- **Collapse the overlay legend on the maps.** The multi-lap overlay legend
  (both the race-line map and the pro-mode MiniMap) now has a collapse toggle.
  With many overlays loaded the per-lap list can bury the map under labels, so
  one tap folds it down to a compact "N overlays" pill — **the racing lines stay
  drawn on the map**, only the list is hidden. Tap again to expand.

### Changed
- **About dialog feature list refreshed.** The home-screen **About** popup now
  lists the analysis features added across the last two releases — the G-G
  diagram, distance/time chart axis, multi-lap overlay (including laps from past
  sessions and other loggers), lap snapshots (fastest lap per engine/course), and
  frozen per-session setup history.

## [2.1.0] - 2026-06-04

### Changed
- **Desktop text labels on header controls.** On large (desktop) screens the
  **Settings** and **Garage** buttons in the header, the **track selection**
  (pencil) button, and the **Snapshots** and **Overlays** controls now show a
  text label next to their icon, taking advantage of the extra real estate. On
  tablet and mobile these stay icon-only — the Snapshots and Overlays controls
  keep their count bubble at every size.

### Added
- **Resizable Pro-mode graphs.** Each graph in the Pro view (and the G-G diagram)
  now has a drag handle along its bottom edge — grab it and drag up/down to set
  that graph's height individually. Heights are saved per session (and sync with
  the rest of your graph layout when cloud sync is on), so a layout you tune for
  one log comes back the next time you open it.
- **Brake % graph now overlays your selected laps.** In Pro view, the computed
  **Brake %** chart draws a line per active overlay lap/snapshot (distance-aligned,
  in each overlay's color), matching the reference brake line — so you can compare
  braking across every overlaid lap, not just the reference.
- **G-G diagram: comparison cloud toggle + per-cloud value readout.** The G-G
  diagram now has a bottom-right info box listing the live G value for every cloud
  on the scrub point (session + the active comparison set, each in its own color),
  with two toggles above it: **Ref / Overlays** swaps the comparison cloud drawn
  beneath your session (reference lap vs. the selected overlay laps, each in its
  own color), and **Lat G / Lon G** switches the readout between lateral and
  longitudinal so the box stays readable.
- **Glowing setup-status indicator in the tab bar.** When the loaded session has
  no setup assigned, an exclamation icon glows just right of the **Coach** tab.
  It glows **red** when there's nothing to assign yet — clicking opens the Garage
  to **Vehicles** (or **Setups** if you already have a vehicle), where the empty
  states now read "No vehicles yet" / "No setups yet" in red. It glows **orange**
  when setups exist but this session isn't linked to one — clicking opens the
  Garage **Notes** tab, which now shows an orange reminder that "a setup should
  be saved for historical data comparisons."
- **"Open Garage" shortcut in the Pro vehicle tab.** When no vehicle is linked to
  the session, the Pro-view **Vehicle** tab now shows an **Open Garage** button
  below **Save Selection** that opens the file-manager drawer straight to the
  relevant Garage sub-tab — **Vehicles** when you have no vehicles yet, or
  **Setups** when you already have one — so you can create what you need without
  hunting for the tab.
- **Inline helper text in the Overlays and Snapshots menus.** The Overlays menu
  now notes that overlays are separate from the main reference lap (where deltas
  are calculated from), and the Snapshots menu explains that you can save one
  snapshot per engine per course, capturing the full lap plus the session's setup
  information.
- **Video panel note when empty.** The "No video loaded" state now mentions that
  segmented videos are not yet supported.
- **Overlays menu — manage overlay lines and set references in one place.** The
  header **Overlays** button (renamed from "Overlay file") now opens a
  three-section menu: **Current overlays** lists every active overlay line, lets
  you promote any of them to the comparison **reference lap** (the active
  reference stays highlighted), and remove them; **Current session laps** toggles
  this session's laps on/off as overlays without leaving the view (the lap list
  still works too); and **Add from other logs** lists the other saved sessions
  tagged with the *current course* — shown by date/time, never raw file names — so
  you can pull in more laps. Snapshots are still added from the separate Snapshots
  menu. The old "External Ref" bar at the top of the lap list is hidden
  (references are now set from the Overlays menu and the per-row **Ref** buttons).
- **Overlay laps from other sessions/loggers, with drift alignment.** The
  multi-lap overlay can pull laps from **other saved files** — open **Overlays**
  (next to Snapshots), pick a log, and toggle its laps onto the maps +
  graphs alongside your current session. Because logs from different days/devices
  carry a GPS offset, an **Align lines** toggle on the map legend rigidly
  registers cross-session overlays (snapshots + external-file laps) onto your
  current lap so the racing lines actually sit on top of each other — same-session
  laps are left untouched (they already share a receiver). Alignment is map-only;
  the graphs compare by distance and were already drift-immune. This closes the
  "align data from different loggers" gap. See `docs/plans/multi-lap-overlay.md`.
- **Build version + commit stamp in the home-page footer.** The landing page now
  shows the running app version and the short git commit hash (e.g.
  `v2.0.0 · 837b514`), baked in at build time. The hash links to that commit on
  GitHub and the build date shows on hover, so it's easy to tell which revision
  is deployed and when something changed. On **preview/non-`main` builds** the
  stamp instead reads **`<branch> · <hash> · <commit time>`**, so you can tell at
  a glance which branch a beta deployment is running.
- **Preview builds shout that they're previews.** On any non-`main` build the
  footer turns amber (standing out in light *and* dark mode) and adds a warning:
  the branch runs on a preview database, accounts can be wiped at any time, don't
  rely on anything but local data, and — if payments are ever enabled — never
  enter real payment information.
- **Manage your tracks straight from the home screen.** A new **Manage Tracks**
  button (below "Download from Datalogger") opens the track manager without
  having to load a datalog first — search for a location, drop the start/finish
  and sector lines, and **draw the track outline** by clicking the map. The
  manual **Draw** tool (previously admin-only) is now available to everyone; when
  a datalog *is* loaded the editor still offers **Generate from lap** to build the
  outline from your GPS trace. Drawings you make are saved with the course and
  travel with it (cloud sync + community submissions).
- **Track drawings are now part of a community submission.** When you submit a
  track/course that has a drawn (or generated) outline, the outline rides along
  with it — flagged with a **+ drawing** badge in the review screen. Adding or
  changing a drawing re-flags an otherwise-unchanged course so it can be
  contributed. In the admin **Submissions** tab, a submitted drawing shows a
  thumbnail preview and an **Apply to course layout** button that saves it onto
  the matching DB course (so it flows into the exported drawings).
- **Preview deployments can target a Supabase preview-branch database.** Builds
  on a non-production branch (Cloudflare Workers Builds / Pages) now prefer
  parallel `*_PREVIEW` build variables (e.g. `HTT_SUPABASE_URL_PREVIEW`), so
  beta/preview URLs point at a Supabase branch database instead of production.
  Production (`main`) builds and local dev are unaffected. See the README
  "Preview-branch backend" deployment section.

### Fixed
- **Cropping the playback range now crops the overlay racing lines on the map
  too.** Narrowing the range slider shrank the active lap's heatmap line (and the
  comparison charts) to the selected section, but the overlaid laps/snapshots on
  the race-line map and Pro mini-map stayed drawn at full lap length. They now
  crop to the same on-track window as the active lap, so every line on the map
  reflects the cropped section.
- **The track dropdown works again after loading a log.** Opening the
  track/course selector from the header (or the track manager) put its dropdowns
  *behind* the dialog, so picking a different track did nothing. The dropdown now
  layers above the dialog and is fully clickable.
- **Course thumbnails now show for outlines you drew yourself.** A course you
  drew (or generated) on the home-screen track manager kept its outline but
  didn't render the little preview thumbnail in the course list — the preview
  only looked at community-DB drawings. It now prefers the course's own drawn
  outline, so your drawing shows up immediately.
- **The home-screen track manager no longer shows "Back to Selection."** With no
  datalog loaded there's no session selection to return to, so the button (which
  dropped you onto an empty track/course picker) is hidden unless a session is
  actually loaded.

### Changed
- **The track/course editor is visual-only and fully auto-saving now.** The
  Manual/Visual toggle (a leftover dev fallback) is gone — every track manager
  uses the map editor. Drawn outlines and dragged start/finish & sector lines
  save the instant you make the change, so the editor's old Done/Close button is
  removed too. A persistent hint — *"Drawing an outline helps on-device course
  detection. Click to place points."* — now shows in the editor across all the
  managers.
- **Adding a track is just a name now.** "Add Track" no longer makes you place a
  start/finish line and define a course up front — a track is simply a name plus
  an auto-filled short name. Courses (each with their own start/finish line) are
  added afterwards from the track's course list, the same way everywhere a track
  can be created. When a log loads on an unknown track, the prompt walks you
  through it in two quick steps: create the track, then add its first course.
- **"Submit to DB" is always visible now, greyed out when there's nothing to
  send.** Previously the button only appeared once you had local tracks. It now
  shows whenever the track manager is open and uses the upload-diffing logic to
  enable itself only when you actually have new/changed courses (or drawings) to
  contribute, with the pending count in the label.
- **Lap-generated outlines are resampled instead of using every raw sample.**
  "Generate from lap" previously copied the full logger-rate GPS trace (hundreds
  to thousands of unevenly-spaced points). It now arc-length-resamples to an even
  spacing scaled to track length — 5 m for karting tracks, ramping up to 10 m for
  long road courses (2→4 miles) — producing a clean, compact outline that's
  lighter to store and submit.
- **"Submit to DB" is now a one-tap bulk contribution instead of a coordinate
  form.** The old flow made you hand-fill latitudes/longitudes for one course at
  a time. Now the app diffs everything you've created locally against the
  community track list and shows a review screen of exactly what will be sent —
  each track flagged **New** or **Edited**, each course flagged **New track**,
  **New course**, or **Modified** — and sends the whole thing as a single upload.
  Courses identical to the built-in ones are skipped automatically, and the app
  remembers what you've already submitted so unchanged courses aren't re-sent
  (editing a course later re-flags it). Adding a course to a built-in track shows
  that track as **Edited** (it adds the course; it never overwrites the track).
- **Track creation now captures a short name, auto-filled from the long name.**
  The "Add Track" form has a **Short Name** field (max 8 chars) that fills in
  live as you type the track name (e.g. "Orlando Kart Center" → "OKC") until you
  edit it yourself. Tracks created before this — or otherwise missing a short
  name — get one auto-derived at submit time, so contributing them is never
  blocked.
- **Bulk submissions are grouped for admin review.** The `submit-track` edge
  function now accepts many courses in one request and tags them with a shared
  `batch_id`; the admin Submissions tab groups a user's upload together with
  **Approve all / Deny all** for the batch. Each course is still its own row, so
  the existing per-submission review/approve flow is unchanged. (Legacy
  single-course submissions still work.)

- **Track editor sector lines now save the moment you release a drag marker.**
  In the visual editor, adjusting the Start/Finish, Sector 2, or Sector 3 line no
  longer requires a separate "Done" click to commit — each line is written to the
  form as soon as you let go of a marker. The footer button is relabeled "Close"
  for line tools (it just dismisses the editor; your edits are already saved) and
  stays "Done" for the layout Draw tool, which still finalizes the drawing on
  click. Removes a confusing extra step where dragging a line and switching tools
  silently discarded the change.
### Added
- **Multi-lap overlay across the maps and graphs.** Select extra laps/snapshots
  to compare and they now draw everywhere at once: as racing lines on **both**
  the simple Race Line map and the pro mini-map, **and** as distance-aligned
  traces on the telemetry charts (the simple speed chart and every pro graph),
  with each lap's value shown in the cursor tooltip. Toggle the **Map** column in
  the lap list to add a lap, or the *Spline* button in the snapshot list to add a
  snapshot; each gets a distinct color with an on-map legend (tap ✕ to remove).
  The **current lap always renders on top** in every view. (Phase 1:
  current-session laps + snapshots, raw GPS. Cross-session drift-alignment and
  external-file/cross-logger overlays are planned follow-ups — see
  `docs/plans/multi-lap-overlay.md`.)
- **G-G diagram (friction circle).** A new pro-mode graph plotting lateral vs.
  longitudinal G as a scatter, so you can see how much of the tyre's grip
  envelope you're using — the classic "are you driving the corners of the
  circle" view from MoTeC / Race Studio. Add it from the graph picker
  ("G-G Diagram"); it shows concentric 0.5 g grip rings, your session's cloud,
  the reference lap's cloud (when one is selected) for comparison, and the live
  point as you scrub. Uses GPS-derived `lat_g`/`lon_g` (or the logger-native
  pair when the HW G-force source is selected), with the same smoothing as the
  other G-force charts.
- **Distance vs. time chart scale.** The analysis charts (simple-mode telemetry
  chart and pro-mode graphs) can now plot against **track distance** instead of
  elapsed time, so laps line up corner-for-corner — the way Race Studio / MoTeC
  analysis works. A new **Chart Scale** toggle in Settings switches between
  Distance and Time; **Distance is the default**. Distance tick labels follow
  the speed unit (MPH → ft/mi, KPH → m/km).
  - The X-axis is **anchored at the start-finish line**: tick labels read in
    *absolute* distance/time from the lap start (e.g. 450 m → 780 m), not from
    the cropped window — `0` is always the start line. Cropping with the range
    handles still zooms the graph; the handles themselves are now labelled in
    the same distance/time scale.

## [2.0.0] - 2026-06-03

### Fixed
- **Spurious sign-out on page refresh (and the paid plan card vanishing with
  it).** The auth bootstrap awaited a Supabase RPC (`has_role`) *inside* the
  `onAuthStateChange` callback. supabase-js holds the GoTrue cross-tab Web Lock
  for the duration of that callback, so the awaited call deadlocked token
  refresh on reload — signing the user out and, downstream, collapsing the
  subscription to the free tier (hiding the paid plan card). The admin-role
  lookup is now deferred out of the callback; session/user state is set
  synchronously. (Symptom only cleared on a full browser restart, since the
  contended Web Lock survives reloads.)

### Changed
- **Pricing cards now clarify that paid plans only cover cloud backups.** Every
  storage line on the plan cards (home + sign-up) carries an asterisk to a new
  footnote spelling out that storage on your own device is always unlimited and
  free — paid tiers only back your datalogs up to the cloud (and help support
  development). Removes the common confusion that you have to pay to keep using
  the app or to store logs locally.
- **Coverage badge now publishes to a GitHub Gist instead of a `badges` branch.**
  The orphan `badges` branch caused Cloudflare Workers Builds to repeatedly try
  (and fail) to deploy a branch with no app in it. The `coverage.yml` workflow
  now pushes the badge `%`/color to a gist via `Schneegans/dynamic-badges-action`
  (repo secret `GIST_TOKEN` + variable `COVERAGE_GIST_ID`), drops its
  `contents: write` permission, and no longer creates a Git branch. See the
  README "Coverage badge" section for setup.
- **Bumped the optional AI coach plugin (`@perchwerks/eye-in-the-sky`) from
  `0.3.0` to `0.4.1`, and pinned it to a tilde patch range (`~0.4.1`)** so coach
  `0.4.x` patch releases are picked up automatically on the next install, while a
  minor/major bump (`0.5.0`+) stays an explicit, reviewed change.
- **Profile moved into the file-manager drawer.** The Profile panel (account,
  storage, lap snapshots, data export) is no longer a tab in the main data view.
  It now lives as a third top-level tab in the slide-out drawer, sitting between
  **Garage** and **Device**, so the main view tab bar stays focused on
  visualizing the session. The drawer also opens at half the screen width (on
  both mobile and desktop) for a bit more breathing room.
- **"Submit to DB" track button now stands out.** In the track manager, the
  button for contributing a user-created track/course to the shared database is
  now a primary-styled call-to-action with a subtle pulsing glow, and sits next
  to a help (`?`) tooltip explaining that sharing track configurations helps the
  project grow for the whole community.
- **Settings menu is now a two-column layout with collapsible sections.** The
  compact toggle settings (units, theme, G-force, lap delta, etc.) lay out in a
  responsive 2-column grid from the tablet breakpoint up (single column on
  mobile), and the modal widens to fit. The lengthy **Braking Zone Detection**
  and **Default Field Visibility** sections are now collapsible — their titles
  toggle the body and both are collapsed by default — to cut the length of the
  menu.

### Security
- **Explicit deny-all RLS policy on `stripe_events`.** The Stripe webhook
  idempotency ledger had row-level security enabled but no policy. Direct client
  access was already denied (only the service role, which bypasses RLS, writes to
  it), but Supabase's database linter flagged it as `rls_enabled_no_policy`. It now
  carries an explicit `FOR ALL ... USING (false)` deny-all policy plus a table
  comment, matching the existing `login_attempts` service-role-only pattern —
  self-documenting defense-in-depth, no behavioural change. A full sweep confirmed
  every table has RLS enabled with appropriate policies, every `SECURITY DEFINER`
  function pins `search_path`, and each edge function enforces its own auth.

### Fixed
- **Active subscription no longer reads as "Free".** The Stripe webhook could
  resolve an entitling subscription (active/trialing/past_due) down to the free
  tier when the price in a webhook payload arrived without its `lookup_key` —
  notably after **un-cancelling** a subscription. The webhook now re-fetches the
  full price when needed and, as a safety net, never demotes an entitling
  subscription to free (it keeps the existing paid tier instead).

### Added
- **Homepage "Build your own datalogger" call-to-action.** A banner below the
  page heading links to the open-source [DovesDataLogger](https://github.com/TheAngryRaven/DovesDataLogger)
  hardware/firmware repo (replacing the old supported-formats subtext).
- **"Coach Plugin" GitHub link** added to the landing page's GitHub link row,
  pointing at the [DataViewer_coach](https://github.com/TheAngryRaven/DataViewer_coach) repo.
- **"Operated by PerchWerks LLC" footer** at the bottom of the landing page,
  linking to [PerchWerks.com](https://PerchWerks.com).
- **More fields in Settings → field defaults.** The show/hide field list now
  includes **horizontal accuracy** (`H Accuracy`, under GPS Data) and the **raw
  IMU accelerometer axes** (`Accel X/Y/Z`) under a new **Motion (IMU)** category,
  so you can default-show or default-hide them like any other channel.
- **Change your plan from your profile.** Subscribers now get a **Change plan**
  button alongside **Manage subscription** in **Profile → Plan**. It deep-links
  straight into Stripe's change-plan screen (swapping your storage tier / billing
  interval on the existing subscription with proration) — cancellation and payment
  methods stay under Manage subscription.
- **Checkout-style sign-up.** Registration now has a **storage-tier dropdown**, a
  **monthly/annual switch**, and a **live cost-per-month** readout next to the
  Create Account button — annual shows the monthly-equivalent price and the **%
  you save** versus paying monthly (prices fetched live from Stripe).

### Changed
- **Google sign-in temporarily hidden.** The "Continue with Google" buttons (login,
  register, Profile) are now gated behind a new `VITE_ENABLE_GOOGLE_AUTH` flag,
  off by default. Google sign-in still routes through Lovable's hosted OAuth broker,
  so it stays hidden until native Supabase Google OAuth is configured. Email
  sign-in/registration is unaffected. Flip the flag back on once the Supabase Google
  provider + Google Cloud OAuth client are set up.
- **Simpler sign-up.** The display-name field is gone — accounts get a random name
  you can change (and reserve) later from your profile. Display names now pass a
  **basic profanity filter**.
- **Fewer plans, by storage.** With tiers now differing only by storage, the
  **Premium** and **Pro** tiers are on hold at launch (like the AI tier) and hidden
  from the pricing UI. Sign-up shows two cards (**Free online** + **Plus**); the
  landing page keeps three (**Free offline**, **Free online**, **Plus**), and the
  offline card lists more of what works without an account.

- **Cloud logs now live in the file browser.** Logs stored in your cloud but not
  yet on this device show **inline in the Track → Course folders** alongside local
  logs (deduped — no more separate "Cloud files" list with doubles), marked with a
  cloud icon. **Tap one and it downloads and opens in a single step.** The
  **"Download all cloud logs"** button moved to **Profile → Cloud logs**, which now
  shows your cloud logs in the same folder hierarchy (with delete).
- **Organized file browser — Track → Course → logs, with filters.** The Files tab
  is now a folder hierarchy instead of a flat list. Sessions are filed under their
  **track**, then **course**; the final list can be grouped by **Engine** or
  **Kart** (logs with neither shown below the groups). Each log is now labelled by
  its **session date/time** — the time of its first GPS fix, e.g. "2/12/2026
  11:15 AM" — instead of the raw filename, so logs read clearly. To keep clicking
  to a minimum, folder levels only appear when there's an actual choice: a single
  track or course is skipped automatically, with a **breadcrumb** always showing
  where you are. Untagged logs get their own "Untagged" bucket. Opening the file
  manager **jumps straight to the current session's track/course**.
- **Setup revisions — frozen setup history per session.** Assigning a setup to a
  session now freezes an **immutable, content-addressed copy** of that setup, so
  the session keeps the exact setup it ran even if you edit the live setup later.
  Each revision carries a short **git-style `#hash`** (6 chars) derived from its
  content: two sessions on the same setup read the **same** hash, and any change —
  a value, or the template (a renamed/added field) — reads a **different** one.
  The setup list shows each setup's current hash; the session's Notes panel shows
  the frozen `#hash` it ran. Revisions sync to the cloud as ordinary garage
  documents (counting toward the same pooled storage budget) and stay unlimited
  on-device. Sets up future session tagging in the file browser. Revisions that
  no session references are swept automatically (a throttled ~3-day background
  prune); the local sweep never deletes the cloud copy another device may need.
- Cloudflare Workers deployment support: `wrangler.jsonc` (static-assets-only
  Worker serving `./dist` with single-page-application not-found handling),
  `public/_headers` (no-cache for the service workers + `index.html`, immutable
  long-cache for hashed assets), an `.nvmrc` pinning Node 20, and a Deployment
  section in the README documenting the build settings and how to flip on admin
  via env vars.
- **Unified cloud storage — one budget, one bar.** Documents, synced logs, and
  lap snapshots now share a **single per-tier cloud-storage allowance** instead of
  three separate quotas: **Free 50 MB · Plus 10 GB · Premium 100 GB · Pro 500 GB**.
  The Profile tab shows it as **one stacked, phone-style progress bar** — logs,
  snapshots, and garage data as coloured segments filling the same limit — with a
  per-segment breakdown. Snapshots are now measured by size (not a fixed count),
  and `subscription_tiers.total_bytes` is the single source of truth the
  server-side quota triggers and the meter both read.
- **Lap snapshots — frozen "course fastest lap" per engine.** Capture a single
  lap (its GPS samples plus a 5-second buffer on each side, the course geometry,
  the engine, and a copy of the vehicle/setup) as an immutable baseline you can
  load and compare against any later session on that course — regardless of the
  engine you're running now (the loaded snapshot shows its engine, so 2-stroke
  vs 4-stroke reads clearly).
  - **One per (course, engine).** Assigning an engine + setup to a log prompts to
    save/update the course fastest lap when its best lap beats (or has no) stored
    snapshot; a manual **Save as snapshot** action lives in the lap-list
    **Snapshots** picker too. A faster lap replaces the snapshot in place.
  - **Loaded as the reference lap (comparison overlay)** — never auto-plays, and
    is excluded from playback and the video player (it rides the reference-overlay
    slot, not the lap selection). Pick one from the **Snapshots** menu next to the
    lap dropdown (simple + pro), or from a **"Load snapshot as reference"** button
    next to the external-reference loader on the lap times page.
  - **Exposed to plugin panels** via `PluginPanelProps.activeSnapshot` (a
    `PluginSnapshot` with clean-lap samples + frozen engine/course/vehicle/setup)
    and `PluginPanelProps.sessionSetup` (the setup the driver is currently
    running), so the AI coach can compare the current session and setup against a
    frozen course-fastest-lap baseline.
  - **Local-first & unlimited on-device; cloud-synced** via a dedicated
    `lap_snapshots` table whose size counts toward the same pooled per-tier cloud
    storage budget as documents + logs (see *Unified cloud storage* below).
    Snapshots always push on save, but a local delete never removes the cloud copy
    (like the log menu); the cloud copy is removed only explicitly from
    **Profile → Lap snapshots**, which also lists on-device snapshots when signed
    out.
- **GDPR self-service data tools** (Profile → **Data & privacy**, cloud builds):
  - **Download my data** — exports everything we hold about you as a single ZIP:
    your account data (profile, subscription, roles, synced garage records,
    contact messages, synced log files) plus the data stored locally in your
    browser (settings, garage stores, local session files). Backed by the new
    `export-account-data` edge function.
  - **Delete my account** — full self-service erasure. Confirmed by an emailed
    one-time code (guards against a hijacked session), then **scheduled 7 days
    out** and cancellable during that window, after which the account, its
    Storage files and all associated rows are permanently erased. Backed by the
    `request-account-deletion` and (cron-driven) `process-account-deletions`
    edge functions.
- **Automatic data-retention (TTL):** a daily job nulls the submitter IP on
  contact messages and community submissions **90 days** after they're received,
  then deletes the rows in full after **1 year** (contact messages entirely;
  community submissions once they've been reviewed — pending ones are kept for
  moderation), and clears expired IP bans and stale sign-in rate-limit records —
  so abuse-prevention and contact data are minimised even without traffic to
  trigger the existing reactive cleanup.
- **Age confirmation at sign-up:** account creation (email and Google) now
  requires ticking a checkbox confirming you are **16 or older**, alongside the
  existing Terms/Privacy agreement.
- **Banned-IP expiry in the admin panel:** banning an IP now takes a selectable
  duration (1 / 7 / 30 / 90 / 365 days or permanent), defaulting to **90 days**;
  expired bans are purged automatically.
- **Customizable engine types for vehicles**: the vehicle form's *Engine* field
  is now a searchable combobox backed by a reusable, per-user engine list. Type
  to filter previously used engines; if the name isn't found, create it inline.
  Existing vehicles' engine names are auto-imported into the list, and a *manage*
  link beside the field opens a small menu for deleting saved engines (engines
  currently in use by a vehicle are protected from deletion). The engine list is
  stored locally (IndexedDB) and travels with the rest of your garage data over
  cloud sync.
- **Terms of Service page** (`/terms`) and a rewritten **Privacy Policy** that
  now accurately reflect the optional online features — accounts, cloud sync,
  Stripe-billed plans, and AI coaching — instead of the old "nothing ever leaves
  your device" copy. Both pages adapt to the build flags (offline-only builds
  show the simpler policy) and are linked from the landing-page footer. Account
  sign-up now states the **16+ age requirement** and links both documents
  (under-16 users use the app offline only). AI coaching is documented as
  informational only — not safety or professional advice.
- **Paid subscription tiers**: Stripe-backed `Plus` ($1/mo), `Premium` ($3/mo),
  and `Pro` ($10/mo + AI coaching) plans that scale your pooled cloud-storage
  budget (10 GB / 100 GB / 500 GB) on top of the free 50 MB tier — see *Unified
  cloud storage* above. Plan limits are data-driven (`subscription_tiers` table)
  and the cloud-sync storage quota is enforced per the user's tier. Backed by
  `create-checkout-session`,
  `stripe-webhook`, and `create-portal-session` edge functions; entitlements are
  granted solely by the verified Stripe webhook. The **Plans & pricing** cards
  now show live **Upgrade** / **Current plan** actions for signed-in users (a
  paid tier stays "Coming soon" until its Stripe Price is configured), and the
  **Profile** tab shows your plan with a **Manage subscription** link to the
  Stripe billing portal.
- **Monthly & annual billing**: each paid tier now offers a monthly or annual
  price, resolved live from Stripe by **lookup_key** (`plus_monthly`,
  `plus_annual`, `premium_monthly`, …) so the Stripe dashboard is the single
  source of truth — no Price ids in code. The pricing cards gain a
  **monthly/annual toggle**, and sign-up lets you **pick a plan + interval**: a
  paid choice creates the account first, then resumes to Stripe Checkout on your
  first sign-in (after email confirmation). A new public `stripe-prices` edge
  function feeds the catalogue.
- **No-Stripe failback**: when no Stripe secret key is configured, the pricing
  UI shows only the two free cards (Guest + Free) and hides the paid tiers
  entirely instead of showing them as "Coming soon".
- **AI (Pro) tier is "coming soon"**: the AI-coaching plan is shown as a teaser
  but isn't self-service purchasable — it's not selectable at sign-up, has no
  Upgrade button, and `create-checkout-session` rejects it. It can still be
  comped to a tester by creating the subscription directly in Stripe (the
  webhook grants whatever tier the price maps to). Gated by a single
  `COMING_SOON_TIERS` set in `lib/billing.ts`.
- **Cancellation grace + log trimming**: cancelling ends service at the period
  boundary and drops you to the free tier's limit, but your cloud logs are kept
  for a **60-day grace window** to re-subscribe or download. After it expires, a
  daily `pg_cron` job (`trim_expired_logs()`) trims synced logs **newest-first**
  until your pooled total fits the free budget (snapshots + garage docs are never
  auto-deleted). The Profile tab surfaces the cancellation/grace date.
- Garage **auto-sync**: when you're signed in, your garage (vehicles, setups,
  setup templates, notes) now backs up to the cloud automatically as you change
  it — no manual push. Garage documents, synced logs, and snapshots all count
  against one pooled per-tier storage budget (free 50 MB), enforced server-side.
- **Propagation deletes**: deleting a vehicle or setup while signed in removes it
  from **every device and the cloud**, with a clear warning before you confirm.
- New **Profile** tab (far right) showing your cloud storage usage as a single
  segmented bar against your pooled tier budget.
- **Cloud log management** (Profile tab): see the session log files stored in your
  cloud — with upload date and size — and delete them. Deleting removes the
  **cloud copy only** (other devices keep what they've already downloaded), with
  an optional toggle to **also delete the local copy from this device**. Clear
  "this can't be undone" warning.
- **User display names**: choose a unique display name when you register, or get a
  fun auto-generated one (e.g. `SpeedyRac3r-546`) if you leave it blank — editable
  any time from the Profile tab, with a clear "that name's taken" message. Existing
  accounts are given a generated name automatically.
- Plugin UI panel framework: plugins can contribute self-contained panels to a
  named slot, starting with the Labs tab. The tab now appears automatically when
  a plugin contributes a panel, and each panel is isolated by an error boundary.
- Dedicated AI Coach tab: a new top-level view (`PanelSlot.Coach`) that hosts the
  coaching plugin's session-debrief dashboard. Like Labs, it is self-gating — the
  tab only appears when the coach plugin is installed and contributes a panel. The
  bundled coach (`@perchwerks/eye-in-the-sky` 0.2.5) ships a full-bleed analysis
  dashboard (uPlot telemetry charts, corner/sector breakdowns) that loads lazily,
  off the initial bundle.
- Plugin panels can now be **chromeless** — a panel may render full-bleed without
  the host's card/header/padding (used by the coach dashboard), while keeping its
  error boundary and Suspense.
- Cloud Sync (first-party plugin, in the Labs tab): sign in to back up and sync
  your session files and garage data (vehicles, setups, notes, graph prefs) to
  the cloud and pull them onto another device. Manual push/pull; data is private
  per account. Requires a backend (Supabase) and a connection — fully optional
  and offline-first otherwise.
- Cloud Sync — per-file selection: each file in the file manager has a sync
  toggle, so you choose exactly which sessions sync (opt-in, off by default).
  Pushing now uploads only your selected files (plus garage data). Selecting a
  file while offline records the intent and uploads once you're back online.
  A "Cloud files" list under the file manager shows everything in your cloud —
  files already on this device are marked as such, and any that aren't get a
  one-click pull.
- Public user accounts (gated by `VITE_ENABLE_CLOUD`, default off): email +
  password sign up / sign in, Google sign-in via Lovable Cloud managed OAuth,
  forgot-password and reset-password flows. New routes: `/register`,
  `/forgot-password`, `/reset-password`, `/auth/callback`. A "Sign in" /
  "Sign out" affordance appears in the landing-page header when the flag is on.
  Regular accounts have no admin privileges (admin role remains driven by
  `user_roles`).

### Added
- Deleting a **synced log locally** now offers an opt-in *"also delete the cloud
  copy"* toggle in the delete confirm (off by default — the cloud copy is a
  backup). When offline, the cloud delete queues and propagates on reconnect.
- Your custom **tracks & courses now sync to the cloud** too (documents storage),
  the same way setups do — auto-sync, delete propagation, and the offline-aware
  timestamp merge. Only your user-created tracks/courses sync; built-in tracks
  stay local.
- **Plans & pricing** cards on the landing page (below the sample) and on the
  registration page — Free offline, Free online (50 MB pooled cloud storage), and
  paid tiers (marked "Coming soon" until billing is wired up).
- **"Download all cloud logs"** button at the bottom of the file manager:
  one-click bulk pull of every cloud log not already on this device.
- Registration now supports a **Cloudflare Turnstile captcha** when
  `VITE_TURNSTILE_SITE_KEY` is set (gracefully skipped when it isn't), and
  rejects **disposable / temporary email** addresses.

### Changed
- **Profile page tidy-up.** The separate *Account* and *Profile* boxes are merged
  into one card: your display name with the **Sign out** button beside it, plan,
  and storage. The manual **Push / Pull** buttons are gone — syncing is automatic,
  so they're no longer needed.
- **Storage & snapshots work signed out.** The storage bar now appears when you're
  logged out too, measuring this device's **local** storage (garage + logs +
  snapshots) against the browser's quota. Lap snapshots now show their **file
  size** in the list, signed in or out.
- File metadata writes now go through a single read-merge helper, fixing cases
  where tagging a track or saving a setup could drop other saved details (kart,
  setup, fastest lap, weather).
- Bumped the optional AI coach plugin (`@perchwerks/eye-in-the-sky`) from
  `0.2.5` to `0.3.0`.
- **Registration page** now shows the **Plans & pricing** cards above the
  sign-up form instead of below it.
- **Cloud Sync moved out of the Labs tab**: sign-in and manual push/pull now live
  on the **Profile** tab as an "Account" panel. The Labs tab no longer appears
  unless the experimental setting is on or a plugin contributes to it.
- Landing-page and About copy now reflect **optional cloud storage** (instead of
  "files never leave your device"), since cloud sync is available when signed in.
- **Garage data and lap snapshots now always sync, even when you're over your
  storage cap.** They still count toward your pooled storage (shrinking the room
  left for logs), but they're never blocked — only logs (and, later, videos) stop
  syncing once the cap is reached. Garage and snapshot data is small and valuable,
  so it shouldn't get locked out by a pool full of logs. The Profile storage panel
  notes this beneath the usage bar.
- Session notes are now capped at **128 KB each** to keep them from being used as
  bulk document storage (they count toward your cloud document storage).
- Cloud document sync is now **offline-aware and conflict-safe**. Garage records
  (vehicles, setups, templates, notes) carry an edit timestamp, and sync uses
  last-write-wins, so a newer change is never overwritten by an older copy.
  Changes made **offline** are saved as pending and, on reconnect, take
  **priority** — replacing the cloud copy. The Profile tab flags when you're
  offline and how many changes are waiting to sync.
- Telemetry channels are now normalized to a canonical identity at import time,
  so the Settings "default fields" show/hide and your saved graph and video-
  overlay selections apply **consistently across every logger format** (e.g.
  lateral G is one channel whether the file came from a Dove, AiM, Alfano, or
  VBO log). Existing files keep their saved graph/overlay choices — legacy field
  names are migrated transparently on load.
- Lap delta / pace is now **position-based** by default: your line is projected
  onto a reference lap resampled to a uniform arc-length grid, so the gap is
  robust to racing-line and GPS-rate differences and no longer drifts over a lap
  (the old cumulative-distance method is selectable under Settings → Lap Delta).
  This upgrades the pace readout everywhere — charts, race-line, overlays, and
  video export.
- Build flag rename: `VITE_ENABLE_REGISTRATION` retired. Cloud auth routes
  (`/register`, `/forgot-password`, `/reset-password`, `/auth/callback`) and the
  Cloud Sync Labs panel are now all gated by the single `VITE_ENABLE_CLOUD`
  flag. `VITE_ENABLE_ADMIN` continues to gate `/admin` independently; `/login`
  mounts when either flag is on. With `VITE_ENABLE_CLOUD` off, no auth pages,
  Google OAuth SDK, or Cloud Sync panel are included in the bundle.
- Build-time env vars now also accept an `HTT_` mirror prefix
  (`HTT_SUPABASE_URL`, `HTT_SUPABASE_PUBLISHABLE_KEY`, `HTT_SUPABASE_PROJECT_ID`,
  `HTT_ENABLE_CLOUD`, `HTT_ENABLE_ADMIN`) so contributors can store backend
  wiring in Lovable workspace build secrets instead of committing a `.env`.
  Precedence: `VITE_*` > `HTT_*` > built-in public fallback. See `.env.example`.
- Lovable preview URLs now aggressively unregister service workers and clear
  Cache Storage so preview tabs stop serving stale builds after updates.
- The optional AI coach plugin now ships from the public npm registry as
  `@perchwerks/eye-in-the-sky` and loads by default — no build token or `.npmrc`
  required. (Previously a private GitHub Packages package gated behind
  `NODE_AUTH_TOKEN`.)

### Security
- **Password reset is now gated on a real recovery session.** `/reset-password`
  only lets you set a new password when the page was opened from the emailed
  recovery link (a `PASSWORD_RECOVERY` token) — so a merely signed-in session (a
  shared/unattended tab, a stolen token) can no longer change the account
  password without proving control of the email.
- **Account deletion now verifies the emailed code server-side.** The
  `request-account-deletion` function verifies the one-time code itself before
  scheduling, so a stolen JWT alone can't schedule deletion via a direct call —
  the caller must also possess the code we emailed.
- **No more cross-account data bleed in cloud sync.** Pending offline changes,
  cloud-deletion tombstones, and per-file sync selections are now partitioned per
  user, so signing out of one account and into another on the same browser can
  never flush the first account's queued state into the second's cloud.
- **Duplicate paid subscriptions are blocked.** Checkout refuses to start a
  second subscription when one is already active (plan changes route through the
  billing portal instead), preventing a double-billed account from a mis-click.
- **Stripe webhook is now replay- and ordering-safe.** Events are de-duplicated
  by id, and a `subscription.deleted` for a superseded subscription is ignored,
  so a retried or out-of-order delivery can't demote an active entitlement.
- **Account-deletion worker deletes the auth user before wiping files**, so a
  transient failure can no longer leave a half-deleted account whose files are
  already gone but whose rows and cancellation window remain.
- **GDPR retention restored to the documented window.** A later migration had
  quietly loosened `purge_expired_personal_data` (keeping rejected-but-unreviewed
  submissions and lock rows past their intended TTL); the documented predicates
  are reasserted.
- Fresh clones default to the **offline-first public app** again:
  `VITE_ENABLE_ADMIN` and `VITE_ENABLE_CLOUD` now default to `false` in the
  build fallbacks, so a build without injected env doesn't ship admin/cloud UI
  pointed at an upstream backend. Production enables them explicitly.

### Fixed
- **Auto-detected track/course is now saved automatically.** When a loaded log's
  track and course are recognised, the session is filed under them in the browser
  immediately — previously the detection only applied in-memory and the log stayed
  "Untagged" until some later manual action (e.g. saving a track) happened to
  persist it.
- **Lap snapshots are now direction-aware.** A course driven in reverse keeps a
  separate "fastest lap" snapshot from the forward direction instead of
  overwriting it (and the position-based pace overlay refuses to compare against
  a reference recorded in the opposite direction, rather than showing nonsense
  gains).
- **Saving a snapshot manually won't silently destroy a faster one.** "Save
  current lap as snapshot" now asks before replacing a stored snapshot that's
  faster than the lap you're saving.
- **Plugin tabs (Coach, Profile, Labs) appear even when a plugin registers its
  panels asynchronously** — the tab list now reacts to plugin contributions
  instead of freezing the snapshot at first render, so the AI coach tab no longer
  goes missing until a full page reload.
- **Pull no longer downgrades a newer local record** or silently opts files into
  ongoing sync — a manual Pull keeps a local edit that's newer than the cloud
  copy and just downloads files without flipping their sync state.
- **Cloud orphan-blob cleanup no longer races a concurrent upload**: only objects
  older than a grace window are reclaimed, so a file uploaded at the same moment
  the Profile tab opens can't be deleted before its index row commits.
- **Lap-snapshot insert failed with `null value in column "id" of relation
  "lap_snapshots" violates not-null constraint`** — same root pattern as the
  missing unique constraint: when the `lap_snapshots` table pre-existed the
  snapshots migration, `CREATE TABLE IF NOT EXISTS` skipped the whole
  declaration, so the `id uuid primary key default gen_random_uuid()` column
  came in without its default. `pushSnapshot` doesn't send an id (it shouldn't),
  so the insert had nothing to fill it with. A follow-up migration re-sets the
  column defaults idempotently so existing deployments self-repair.
- **Lap-snapshot upsert failed with "no unique or exclusion constraint matching
  the ON CONFLICT specification"** when the `lap_snapshots` table pre-existed
  the snapshots migration — the inline `unique (user_id, course_key, engine_key)`
  in `CREATE TABLE IF NOT EXISTS` was skipped along with the table, so reconcile
  and the manual "Sync local snapshots" button both errored. A follow-up
  migration adds the constraint as an idempotent unique index so existing
  deployments self-repair on apply.
- **PostgREST schema cache reload** after the subscriptions/snapshots migration
  batch. Newly-created tables and functions (`subscription_tiers`,
  `user_subscriptions`, `lap_snapshots`, `snapshot_usage()`, …) existed in the
  database but were invisible over the REST API until the cache reloaded —
  breaking checkout (non-2xx), lap-snapshot sync, and the snapshot usage meter
  while Stripe price loading (which bypasses PostgREST) still worked. A migration
  now issues `notify pgrst, 'reload schema'`.
- Lap-snapshot and document auto-sync now reconcile **independently** — a failure
  in one (a missing table, a quota rejection) no longer silently skips the other.
- The Profile **Lap snapshots** panel no longer blanks out when the usage meter
  can't load; the snapshot list stays usable and the meter is treated as
  best-effort.
- The Profile **Lap snapshots** panel now reconciles on open (uploading any
  local-only snapshots) and refreshes live on snapshot changes, so it
  self-heals a sign-in reconcile that failed (e.g. a transient outage) without
  needing an app reload.
- Cloud log uploads no longer **orphan a blob** when the server quota rejects the
  index write — the just-uploaded blob is rolled back. Any pre-existing orphans
  are reclaimed when the Cloud logs panel is opened.

## [1.5.0] - 2026-05-22

The first changelogged release. Dove's DataViewer is a feature-complete,
offline-first, installable PWA for viewing and analyzing motorsport telemetry —
live at [hackthetrack.net](https://hackthetrack.net). This release also adds the
open-source project scaffolding and a bundle-size pass.

### Added — Open Source & Tooling
- Open-source project hygiene: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, this `CHANGELOG.md`, GitHub issue/PR templates, and
  Dependabot configuration.
- README **Credits** and **License** sections; populated `package.json`
  metadata (name, version, license, repository, author).

### Added — File Formats
- Auto-detecting import for UBX (u-blox), VBO (Racelogic/RaceBox), Dove &
  Dovex (DovesDataLogger), Alfano, AiM MyChron, MoTeC (CSV + native LD binary),
  and NMEA 0183.
- `.dovex` extended format with an 8 KB metadata header (driver, course, lap
  times) that degrades gracefully to raw GPS if metadata is corrupt.

### Added — Analysis & Visualization
- Automatic track & course detection within a 5-mile radius, with
  forward/reverse direction detection.
- Waypoint mode fallback for lap timing with no known track.
- Automatic lap detection via start/finish line crossing, with 3-sector split
  timing and optimal-lap calculation.
- Interactive Leaflet race-line map with speed heatmap and braking-zone
  detection/visualization.
- Pro graph view with multi-series Canvas telemetry charts, reference-lap
  overlay, and pace-delta comparison.
- G-force derivation from GPS with configurable smoothing.

### Added — Video & Overlays
- Video sync with telemetry playback.
- Nine overlay gauge types (digital, analog, graph, bar, bubble, map, pace,
  sector, lap time) with Classic and Neon themes.
- MP4 export via WebCodecs (H.264 + AAC), with a MediaRecorder fallback.

### Added — Data Management
- Vehicle profiles, template-driven setup sheets, and per-session notes.
- IndexedDB-backed storage for files, metadata, karts, notes, setups,
  video-sync points, and graph preferences.
- Custom track & course editor with map drawing and community submissions.

### Added — Devices & Connectivity
- BLE integration with the DovesDataLogger (file download, device settings,
  battery, and full track sync over Web Bluetooth).
- Local weather lookup (IEM ASOS / NWS).
- Optional, fully gated admin backend (Supabase) for the community track
  database — the core app makes zero database calls on normal loads.

### Added — Platform
- Installable PWA with full offline support via service worker + IndexedDB.
- Dark & light mode.

### Changed — Quality Pass (May 2026)
- Enabled TypeScript strict mode and fixed resulting type issues.
- Split CI into parallel lint / typecheck / test / build workflows with README
  badges.
- Refactored `Index.tsx` into composable hooks/contexts; split the BLE module
  into per-concern files under `src/lib/ble/` and added protocol tests.
- Hardened PWA cache recovery (NetworkFirst HTML, legacy `/sw.js` kill-switch),
  added safer production env fallbacks, and added SEO metadata
  (sitemap, robots, per-route head tags, `llms.txt`).
- Code-split the bundle with `React.lazy` boundaries and `manualChunks` vendor
  splitting, shrinking the initial gzip payload (~403 KB → ~294 KB) by deferring
  admin, pro view, file-manager drawer, BLE download, and the Leaflet editor off
  the first-load path.

[Unreleased]: https://github.com/TheAngryRaven/DovesDataViewer/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/TheAngryRaven/DovesDataViewer/compare/v1.5.0...v2.0.0
[1.5.0]: https://github.com/TheAngryRaven/DovesDataViewer/compare/V1.0.0...v1.5.0
