-- ============================================================================
-- Backfill: historical release posts for the /updates blog (plan 0012)
-- ============================================================================
--
-- One post per shipped release, from the V1.0.0 beta (March 2026) through
-- v3.1.1, reconstructed from CHANGELOG.md, the git history, and the GitHub
-- release pages. Every post is tagged "web update" (WEB_UPDATE_TAG in
-- src/lib/blogPosts.ts) so the landing page "Latest updates" panel picks the
-- newest one up, and links to its GitHub release page.
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL editor and run it. The editor
--   connects as postgres, which bypasses RLS, so the admin-only insert policy
--   on public.posts is not in the way.
--
--   This is deliberately ONE statement using only standard SQL literals.
--   An earlier draft wrote the post bodies as dollar-quoted strings
--   ($tag$...$tag$) across 23 statements inside BEGIN/COMMIT, with a temp
--   table holding the author id. Postgres parses that happily (verified), but
--   the Supabase SQL editor does not -- it reported a syntax error at a
--   timestamp in the middle of the second INSERT, i.e. it had lost track of
--   where statements begin. Avoiding both dollar-quoting and any cross-
--   statement state sidesteps the whole question.
--
--   Practical consequence: apostrophes in the bodies are escaped the standard
--   way, as two single quotes ('' ). Keep that in mind when editing prose here.
--
-- SAFE TO RE-RUN
--   ON CONFLICT (slug) DO NOTHING, so re-running skips posts that already
--   exist and never overwrites a post you have edited in the admin UI. To
--   re-import one, delete that row first.
--
-- AUTHOR
--   author_id resolves to the first account holding the admin role. To pin a
--   specific account, replace that subquery near the bottom with a literal:
--     '00000000-0000-0000-0000-000000000000'::uuid
--
-- AI-ASSISTED FLAG
--   These bodies were drafted from the changelog with AI assistance, so every
--   post is inserted with ai_assisted = true (shown as a badge on the public
--   page). To drop the badge across the board after import:
--     update public.posts set ai_assisted = false where 'web update' = any(tags);
--
-- DATES
--   published_at is each release's actual GitHub publish timestamp (UTC),
--   which keeps the index in true release order. These are within a day or two
--   of the dates in CHANGELOG.md where the two differ.
-- ============================================================================

insert into public.posts (
  slug, title, body, tags, ai_assisted, published, published_at, created_at, updated_at, author_id
)
select
  v.slug,
  v.title,
  v.body,
  array['web update']::text[],
  true,                                   -- ai_assisted
  true,                                   -- published
  v.published_at,
  v.published_at,                         -- created_at
  v.published_at,                         -- updated_at
  (select ur.user_id from public.user_roles ur where ur.role = 'admin' limit 1)
from (values
  --  1. V1.0.0
  ('welcome-to-the-beta', 'Welcome to the Beta', 'Dove''s DataViewer went public as a beta on March 3, 2026, after roughly two months of heads-down work through January and February. The pitch was simple: a data analytics app for your racing data that runs in a browser, works offline, and does not want your telemetry. Primarily aimed at kart racing to start with, because that is what it was being built alongside.

Everything that mattered was already there in some form. You could drag in a log, have the app work out which track you were at, count your laps, and look at the racing line and the speed trace. It was rough in places, but it was a real tool rather than a demo.

### What the beta shipped with

- **Drag-and-drop log import** with automatic format detection, so you did not have to tell the app what kind of file you were handing it.
- **Automatic track and course detection** from the GPS trace, with lap counting off the start/finish line and three-sector splits.
- **An interactive race-line map** with a speed heatmap, alongside a synced telemetry chart.
- **Video sync** so footage could be played against the data.
- **A track and course editor** for venues that were not in the database yet.
- **Bluetooth download** straight from a DovesDataLogger, no cables or desktop software.
- **Fully offline operation.** The database was only ever needed for community track submissions, and could be switched off entirely with a pre-build flag.

The setup template system was the known weak spot at this point and got revamped later. But the shape of the app — offline first, everything in the browser, nothing on a server that could be done on your device — was set here and has not changed since.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/V1.0.0)
', '2026-03-03T04:29:03Z'::timestamptz),

  --  2. v1.5.0
  ('v1-5-0-open-source-and-the-first-real-changelog', 'v1.5.0 — Open Source, and the First Real Changelog', 'v1.5.0 is where the project stopped being a personal tool with a public URL and started behaving like an open-source project. It is also the first release with a changelog, which is why the entry for it reads as a summary of everything accumulated since the beta rather than a tidy list of one release''s worth of changes.

The headline for users is that a lot of format support landed. The viewer now auto-detects and imports UBX (u-blox), VBO (Racelogic and RaceBox), Dove and Dovex, Alfano, AiM MyChron, MoTeC (both CSV and the native LD binary), and raw NMEA 0183 — all parsed in the browser, offline, with no conversion step.

### Analysis and visualisation

- Automatic track and course detection within a five-mile radius, including forward/reverse direction detection, with a waypoint-mode fallback for venues the app has never seen.
- Lap detection from start/finish crossings, three-sector splits, and an optimal-lap calculation.
- The Leaflet race-line map with a speed heatmap and braking-zone detection.
- Pro graph view: multi-series canvas telemetry charts, a reference lap overlay, and pace delta.
- G-force derived from GPS with configurable smoothing.

### Video, data, and devices

- Nine overlay gauge types (digital, analog, graph, bar, bubble, map, pace, sector, lap time) in Classic and Neon themes, with MP4 export via WebCodecs.
- Vehicle profiles, template-driven setup sheets, and per-session notes, all stored in IndexedDB.
- BLE integration with the DovesDataLogger: file download, device settings, battery, and full track sync.

### Under the hood

Contributor scaffolding (`CONTRIBUTING.md`, `SECURITY.md`, a code of conduct, issue and PR templates, Dependabot), TypeScript strict mode, CI split into parallel lint / typecheck / test / build workflows, and a bundle-splitting pass that cut the initial gzip payload from roughly 403 KB to 294 KB by deferring admin, pro view, the file drawer, the BLE flow, and the Leaflet editor off the first-load path.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v1.5.0)
', '2026-05-22T00:38:01Z'::timestamptz),

  --  3. v2.0.0
  ('v2-0-0-accounts-cloud-sync-and-the-plugin-framework', 'v2.0.0 — Accounts, Cloud Sync, and the Plugin Framework', 'v2.0.0 is the largest release the project has had, and the one that added the entire optional online half of the app. Accounts, cloud sync, subscriptions, GDPR tooling, and a plugin framework all landed together. None of it is required: with the cloud flags off, the app never so much as downloads the backend client, and everything you could do before you can still do signed out and offline.

### Accounts and cloud sync

Email sign-up and sign-in, unique display names (with a generated one like `SpeedyRac3r-546` if you leave it blank), and a Profile tab. Your garage — vehicles, setups, templates, notes, graph preferences — auto-syncs as you change it, with last-write-wins on an edit timestamp and offline changes taking priority when you reconnect. Log files sync per file, opt-in, off by default. Cloud logs show up inline in the file browser''s Track → Course folders, and tapping one downloads and opens it in a single step.

### The file browser grew up

The flat file list became a **Track → Course → logs** hierarchy, with each session labelled by its date and time (from the first GPS fix) rather than the raw filename. Folder levels are skipped when there is no actual choice to make, with a breadcrumb showing where you are.

### Lap snapshots and setup revisions

Two features that make cross-session comparison honest. **Lap snapshots** freeze a course fastest lap per engine — GPS samples plus a five-second buffer, the course geometry, the engine, and a copy of the vehicle and setup — loadable as a reference overlay in any later session. **Setup revisions** freeze an immutable, content-addressed copy of a setup when you assign it to a session, each carrying a short git-style `#hash`, so a session keeps the exact setup it actually ran even after you edit the live one.

### Plugins, plans, and privacy

- A **plugin framework** with auto-discovery, panel slots, and error-isolated rendering — which is how the AI Coach tab and Cloud Sync ship.
- **Paid tiers** (Stripe-backed) that scale a single pooled cloud-storage budget: free 50 MB, Plus 10 GB, Premium 100 GB, Pro 500 GB. Local storage is unlimited and always free — paid plans only back your logs up.
- **GDPR self-service**: download everything we hold about you as a ZIP, or schedule account deletion (confirmed by an emailed code, cancellable for seven days), plus automatic retention TTLs on contact and submission data.
- A **Terms of Service** page and a rewritten Privacy Policy that actually describe the optional online features.

Also in this release: position-based lap delta became the default (projecting your line onto an arc-length-resampled reference, so the gap no longer drifts over a lap), and telemetry channels are now normalised to canonical identities at import time, so your field, graph, and overlay choices apply consistently no matter which logger the file came from.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.0.0)
', '2026-06-01T03:56:00Z'::timestamptz),

  --  4. v2.1.0
  ('v2-1-0-multi-lap-overlays-and-the-g-g-diagram', 'v2.1.0 — Multi-Lap Overlays and the G-G Diagram', 'If v2.0.0 was about storage and accounts, v2.1.0 is about actually comparing laps. Multi-lap overlays, the G-G diagram, and distance-based chart axes all landed here, and together they are the release that made the app feel like a proper analysis tool rather than a viewer.

### Multi-lap overlays, everywhere at once

Select extra laps or snapshots and they now draw in every view simultaneously — as racing lines on both the race-line map and the pro mini-map, and as distance-aligned traces on the telemetry charts, with each lap''s value in the cursor tooltip. Your current lap always renders on top.

Overlays can also come from **other saved sessions and other loggers**. Because logs from different days or devices carry a GPS offset, an **Align lines** toggle rigidly registers cross-session overlays onto your current lap so the racing lines actually sit on top of each other. Same-session laps are left alone — they already share a receiver. A rebuilt **Overlays** menu lets you manage active overlay lines, promote any of them to the comparison reference, toggle this session''s laps, and pull laps in from other logs tagged with the current course.

### Distance instead of time

The analysis charts can now plot against **track distance** instead of elapsed time, so laps line up corner-for-corner the way Race Studio and MoTeC do it. Distance is the new default. The axis is anchored at the start/finish line, so zero is always the start line, even when you crop the range.

### G-G diagram

A new pro-mode graph plotting lateral against longitudinal G as a scatter, with concentric 0.5 g grip rings, your session''s cloud, the reference lap''s cloud for comparison, and a live point as you scrub. The classic "am I using the corners of the circle" view.

### Track tools for everyone

- **Manage Tracks from the home screen**, with no datalog loaded. Search a location, drop the lines, draw the outline.
- The manual **Draw** tool, previously admin-only, is now available to everyone.
- **Submit to DB** became a one-tap bulk contribution: the app diffs your local tracks against the community list and shows exactly what will be sent, each item flagged New, Edited, or Modified, sent as a single upload.
- Resizable pro-mode graphs, saved per session.
- A build version and commit stamp in the footer — amber, with a loud warning, on preview builds.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.1.0)
', '2026-06-04T04:52:57Z'::timestamptz),

  --  5. v2.2.0
  ('v2-2-0-native-aim-xrk-import-and-worldwide-weather', 'v2.2.0 — Native AiM .xrk Import and Worldwide Weather', 'Two long-standing gaps closed in v2.2.0: AiM''s native binary logs now open directly, and session weather works outside the United States.

### Native AiM `.xrk` / `.xrz` import

MyChron and SoloDL binary logs can be dragged straight in — no RaceStudio export step, no conversion to CSV. They flow through the normal pipeline like any other format, including as reference laps, multi-lap overlays, and lap snapshots.

The interesting part is how. Parsing runs entirely client-side using [libxrk](https://github.com/m3rlin45/libxrk)''s pure-Rust core compiled to a roughly 200 KB WebAssembly module — no Python, no Pyodide — running in a Web Worker so a large session never freezes the UI. The wasm is precached, so it works fully offline, and a typical session parses in tens to a couple of hundred milliseconds.

### Worldwide weather

The US path is unchanged (nearest NWS/ASOS station, then historical METAR), but when there is no US station nearby — a session in Europe, say — the lookup now falls back to [Open-Meteo](https://open-meteo.com)''s free, keyless global historical reanalysis by latitude and longitude. Temperature, humidity, pressure, density altitude, and wind resolve anywhere. The source is shown in the widget and cached per session.

### Also in this release

- **Pick the satellite imagery date.** The default Esri basemap bakes in whatever clouds or seasonal cover were in that capture. The race-line map''s satellite view now has a date picker, powered by Esri Wayback, to step back to an earlier, cloud-free capture of the same track. Online-only and lazy-loaded.
- **A full-screen loading overlay on file open**, with a live status message for slow formats (chiefly the new XRK path), so it is clear the app is working rather than stuck.
- **Session date and time on untagged logs** — a session''s start time is now recorded on import even when its track is not in the database yet, which is common for XRK logs from new venues.
- The multi-lap overlay legend on both maps now **collapses** to a compact "N overlays" pill. The racing lines stay drawn; only the list folds away.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.2.0)
', '2026-06-05T00:00:57Z'::timestamptz),

  --  6. v2.2.1
  ('v2-2-1-track-editor-fixes-and-an-on-screen-debug-console', 'v2.2.1 — Track Editor Fixes and an On-Screen Debug Console', 'A quick follow-up to v2.2.0, aimed almost entirely at the track and course editor — plus a small tool that makes debugging on a phone possible at all.

### Track editor

- **The satellite imagery date picker** is now in the visual track editor too, not just the race-line map, so you can step the basemap back to a cloud-free capture while you are placing start/finish and sector lines.
- **Generate an outline with no laps.** Load a file from a brand new venue and there may be no detected laps to build an outline from. The Generate tool now offers a **Whole session** option that works straight from the full GPS trace, and it is wired into the post-import "Create Track" prompt so it works while you are first setting the track up.
- **New tracks apply immediately.** Creating a track or course with a session loaded now re-processes the current file right away — laps recompute, and the track appears in the dropdown without a page refresh. Editing the active course does the same.
- **Outline generation actually works on real telemetry now.** The polyline resampler was accumulating distance incorrectly across segments, so a dense GPS trace where samples sit about a metre apart collapsed to a single point and generated nothing at all. It now accumulates arc length across short segments properly. A trace that genuinely is too short reports a clear error instead of silently doing nothing.

### Debug console for phones

Load the app with `?dbg=true` and you get a bottom overlay mirroring `console.*` output plus uncaught errors and promise rejections, with copy, clear, and collapse controls. Phones and installed PWAs have no dev tools, so this is the difference between an invisible runtime error and a readable one. The flag persists, and the overlay renders nothing at all unless enabled.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.2.1)
', '2026-06-05T01:52:24Z'::timestamptz),

  --  7. v2.2.2
  ('v2-2-2-iracing-ibt-telemetry-import', 'v2.2.2 — iRacing .ibt Telemetry Import', 'Sim racers get a native path in v2.2.2: iRacing''s binary `.ibt` telemetry files can be dropped straight into the viewer, with no third-party conversion to CSV or MoTeC first.

The `.ibt` is parsed directly in the browser, offline, into the same GPS-first session as every other format. Position, speed, and altitude drive the map and lap detection, with throttle, brake, gear, steering, RPM, water and oil temperature, and native lateral and longitudinal g all available as channels. It is listed in the **Supported Files** dialog alongside the AiM binary format.

### AiM CSV fixes

Two related bugs meant RaceStudio 3 exports could not be loaded at all:

- **RS3 CSVs now import.** RaceStudio 3 uses space-delimited channel names (`GPS Speed`) and puts the channel header roughly fifteen rows below the metadata, so the AiM parser neither detected nor parsed them — and the broad Alfano detector claimed the file, then failed. The AiM parser now recognises the `AiM CSV File` signature, matches space- and underscore-delimited names alike, and scans deep enough to find the header. The format router gives an AiM-signed file precedence over Alfano.
- **AiM sessions carry their real date.** The parser now reads the `Date` and `Time` rows from the RaceStudio metadata, so AiM imports get a proper session start time. That feeds the historical weather lookup and the file-browser session naming, both of which previously fell back to import time. Unparseable or locale-specific dates degrade to no date rather than failing the import.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.2.2)
', '2026-06-05T05:27:46Z'::timestamptz),

  --  8. v2.3.0
  ('v2-3-0-firmware-updates-over-bluetooth', 'v2.3.0 — Firmware Updates Over Bluetooth', 'You can now update your DovesDataLogger''s firmware straight from the browser. No desktop tools, no cables, no taking the device apart.

The **Device → Settings** tab shows the installed firmware version with a **Check for updates** button. When a newer build is available, a confirmation dialog (with battery and don''t-power-off warnings) runs the update: the image is downloaded, verified against the published checksum, uploaded to the logger''s SD card, then the device re-checks the checksum itself, installs it, and reboots into the new firmware. You get a "Flash complete" prompt to reconnect when it is done.

The image is **CRC-32 verified at every hop** — publisher, download, device control channel, and the on-device file — so a corrupt or wrong-variant transfer can never be flashed. Fetching the firmware needs a connection; everything else runs in the browser. Beta builds pull from a separate beta firmware channel and always offer the update, for testing.

### Independent unit toggles

Settings now has three separate imperial/metric switches instead of one speed toggle:

- **Speed** — MPH ⇄ KPH.
- **Distance** — ft/mi ⇄ m/km. Track lengths, the lap and chart distance axis, the range-crop labels, and metre-based telemetry channels like Distance and Altitude in the graphs and video overlays.
- **Weather** — °F/mph/inHg/ft ⇄ °C/(km/h)/hPa/m. Temperature, dew point, wind, pressure, and density and pressure altitude.

Each is app-wide and remembered per device, and all three default to imperial.

### Clearer pricing cards

The plan cards now lead with bold titles — **Just the App** (offline) and **Cloud Access** (the online plans). Instead of two cards both titled "Free" showing "$0", which read as duplicates and tripped up screen-reader users, the no-cost cards now show the word **Free** where the price goes, and only the paid plan shows an actual price.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.3.0)
', '2026-06-10T01:41:35Z'::timestamptz),

  --  9. v2.3.1
  ('v2-3-1-home-page-reshuffle', 'v2.3.1 — Home Page Reshuffle', 'A small housekeeping release, entirely about first impressions — moving the sample data to the top of the home page so new visitors can try the viewer before anything else asks them for a file.

- **Try it out, first.** The sample-data panel moved to the top of the home page, above the file import, with the "Build your own datalogger" card below it. New visitors should see how to try the viewer before they see anything else.
- **The Contact button stands out.** It is now a filled primary button in the header instead of a muted outline, so it is actually findable.
- **The About dialog mentions OTA.** Over-the-air firmware updates for the DovesDataLogger, added in v2.3.0, are now in the feature list where people will see them.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.3.1)
', '2026-06-10T03:55:03Z'::timestamptz),

  -- 10. v2.4.0
  ('v2-4-0-a-big-performance-pass', 'v2.4.0 — A Big Performance Pass', 'v2.4.0 has almost nothing new to click on and is one of the most useful releases the app has had. It is a performance and correctness pass: the app got roughly 40% lighter to load, playback got dramatically cheaper, and four parser bugs that were quietly corrupting data got fixed.

### Faster and lighter

- **~40% smaller landing page.** The initial payload dropped from about 1.13 MB raw / 334 kB gzip to 684 kB / 207 kB. The map stack (Leaflet plus the Simple view) now loads when a session opens rather than up front, and the Supabase client is completely off the eager path — offline-first builds never download it at all.
- **Playback runs at real time.** The playback loop no longer tears itself down and re-anchors its clock on every cursor tick, so 60 Hz data plays at full speed instead of capping at half the display rate.
- **Playback is dramatically cheaper.** The playback cursor moved into its own context, so a tick only re-renders components that track it. The charts now draw on two stacked canvases — a static layer for grid, lines, and overlays, and a separate cursor layer — so moving the cursor costs a clear, a line, and a tooltip instead of a full redraw. Dense series are decimated to per-pixel min/max pairs before stroking.
- **The heatmap was rebuilt for large sessions.** The race-line speed heatmap now renders as about twenty canvas-drawn colour-bucket polylines instead of one SVG element per GPS segment, which could attempt tens of thousands of DOM nodes and freeze the tab.
- **Video export no longer holds the whole MP4 in memory.** Long exports — twenty minutes at high quality is roughly 2.2 GB — now stream out in ~16 MB fragmented-MP4 chunks, which was previously a guaranteed out-of-memory crash on mobile. Both encoders now run with bounded queues.

### Parser fixes worth knowing about

- **VBO time parsing.** The `time` column is now decoded as the spec''s packed UTC `HHMMSS.SS` by digit position. Previously any session before 10:00 UTC was misread as seconds since midnight, injecting about 40 phantom seconds at every minute boundary and corrupting lap times.
- **VBO coordinates.** Standard Racelogic exports store latitude and longitude as total decimal minutes with longitude positive *west*. The parser now detects this per file, instead of placing your race line about 2,300 km away with the hemispheres mirrored.
- **AiM CSV speed units.** The km/h vs m/s vs mph decision now comes from the file''s explicit unit label rather than the first GPS-valid row, so a session that started slowly rolling out of the pits no longer has every speed multiplied by 3.6.
- **Alfano time units** are now decided once per file from the whole column, rather than a per-row heuristic that flipped after 100 seconds and made time run backwards.
- **Charts no longer crash on very long sessions.** Min/max computations used argument spreading, which threw a stack-overflow above roughly 65k samples — viewing All Laps on a two-hour 20 Hz session, for instance — and blanked the chart.
- **UBX session start times** are built from the receiver''s UTC fields, so they are no longer shifted by the browser''s time zone.
- **Course auto-detection** now enforces the documented 25% length tolerance, rejecting a mismatched course into waypoint mode instead of tagging your session with the wrong sector lines.
- **Native g-force channels** from AiM CSV, MoTeC, and XRK are never silently clobbered or dropped; when a file supplies only one axis, that axis is preserved and the missing one is derived.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.4.0)
', '2026-06-12T23:59:18Z'::timestamptz),

  -- 11. v2.5.0
  ('v2-5-0-unlimited-sectors-and-the-tools-tab', 'v2.5.0 — Unlimited Sectors and the Tools Tab', 'Three sectors is a convention, not a law. In v2.5.0 a course is no longer limited to three fixed sectors — and the app grew a Tools tab for the trackside calculators that have nothing to do with a datalog.

### "Unlimited" course sectors

The course editor now shows an ordered, drag-to-reorder sector list below the map. Add as many sectors as you like (up to 25 timing lines per course), mark exactly three of them — start/finish counts as one — as **Major sectors**, and group sub-sectors under each major. Start/finish, major, and sub-sector lines are drawn on the race-line map in three distinct colours.

The wire format to the DovesDataLogger is unchanged: only the three majors are uploaded to the device, so sub-sectors are an app-only refinement. Track JSON, community submissions, and the admin database carry the full ordered list.

Two things follow from that:

- **The optimal lap is now computed from the best time in every sector**, not just the three majors.
- **The lap-times list has a Simple/Full toggle.** Full shows one column per fine-grained sector, zebra-striped by major group and horizontally scrollable, with a coloured **"S# Sum"** column before each major''s columns showing that major''s running total per lap, fastest highlighted.

### Crop to a sector

The data-crop bar on the Simple and Pro views now pairs the range slider with a sector dropdown — pick a sector and the view snaps to that section of the selected lap.

### Tools tab

A new main-view tab to the right of Coach, contributed by a first-party `tools` plugin, opening on a picker of tools you click into. The first one is the **kart seat position visualizer** (tagged *super experimental*): a side-view rigid-body statics model showing how a fore/aft seat slide (±1", 1/16" detents) and a seat tilt (±5°, or rear-mount mm) shift front/rear weight distribution and CoG height. A stick-figure driver with feet-on-pedals knee IK makes the leg-coupling model visible. It reads out signed Δrear %, per-axle weight, CoG height change, local sensitivities in %/inch and %/degree, and a 1.5 g lateral-transfer indicator. A corner-scale calibration flow anchors the baseline to your kart. Fully offline.

Also: the main tab bar is icons-only on phones now, and sector lines in the course editor are drawn noticeably thicker so they stand out against satellite imagery.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.5.0)
', '2026-06-13T04:33:52Z'::timestamptz),

  -- 12. v2.5.1
  ('v2-5-1-landing-page-ux-overhaul', 'v2.5.1 — Landing Page UX Overhaul', 'The home screen had accumulated a cluster of small buttons inside the file dropzone, which is a fine way to grow a page and a bad way to design one. v2.5.1 is a layout and usability pass that made it simpler and friendlier. Colours and design tokens are unchanged — this is purely about where things are.

- **Importing a file is now one large drag-and-drop / click-to-browse zone**, and nothing else. The button cluster is gone.
- **Every other action is a big, clearly-labelled tile**: load sample data, browse saved files, download from the logger over Bluetooth, manage tracks, build your own logger.
- **Pricing is off the landing page.** It lives on the registration page, where you actually pick a plan.

### Mobile garage and header polish

The Garage/Device drawer now covers the full screen on mobile, staying at half width on larger screens, which makes it far easier to use on a phone. In the loaded-session header, the track/course label and its edit button were consolidated into a single course control, using a route icon at every screen size with the current **track : course** as its label from tablet width up.

### Log type bubbles in the file browser

Each session row — which is shown by date and time, not filename — now carries a small pill with the log''s format: Dove, Dovex, XRK, XRZ, iRacing, VBO, MoTeC, UBX, NMEA, CSV, and so on, derived from the file''s extension. It appears on local rows, cloud rows, and in the Profile → Cloud logs list, so you can tell at a glance what kind of log each one is.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.5.1)
', '2026-06-13T05:57:55Z'::timestamptz),

  -- 13. v2.6.0
  ('v2-6-0-seven-languages-and-your-phone-as-a-datalogger', 'v2.6.0 — Seven Languages and Your Phone as a Datalogger', 'Two big additions in v2.6.0: the app speaks seven languages, and your phone can now act as a live lap timer and datalogger with no hardware at all.

### Translations

The app now has a full internationalization system with a **Language** picker in Settings. It auto-detects your browser language on first run and ships **English, Spanish, French, German, Italian, Brazilian Portuguese, and Japanese**. Non-English languages start as machine translations and get hand-tuned over time.

Everything stays fully offline — each language loads on demand and is cached by the app. The whole app is translated: the home screen, Settings, the core in-session UI, the race-line map and pro graph view, the video player and overlay/export tools, the Garage drawer, Setups and Notes, Device settings and the firmware updater, the weather panel, the track editor and community submission flow, the Cloud Sync profile panels, the account pages, and every tab of the admin panel. Open-source library names and the legal pages stay in English by design.

### Phone as a datalogger (early/experimental)

A new tool turns your phone''s GPS into a live lap timer: a big delta against your best lap — red when you are slower, green when faster — plus current, best, last, and optimal lap times, speed, and a **Lap Times** list with major-sector splits.

It starts recording once you are moving above 5 mph and saves the session as a `.dovep` log to your files when you end it (auto-ending after five minutes stopped, or when you tap **End**). From there it opens and reviews exactly like any other log. This is early days and the timing and UI will be refined, but it works.

### Also

- **A Tools tile on the home screen** opens the trackside tools full-screen, with no datalog needed.
- The **start/finish line can be placed on a brand-new course again** — after the sector-editor overhaul a fresh course had no coordinates for it, so it effectively sat at null island with no way to create or drag it. It is now dropped into the centre of the current map view, with a **reset** button to re-drop it.
- **The track editor map works on the home screen.** Opening the satellite editor with no session loaded rendered scattered tiles and an off-centre zoom, because Leaflet''s stylesheet was only pulled in by the in-session maps.
- **Pro-mode panel resizing works on touch.** The divider grab strips were a few pixels wide while the drag-start margin extended over the neighbouring chart, so a finger landing just off the divider had its gesture reclaimed as a scroll.
- **The phone datalogger names the track it recognises** while you are parked, instead of looking identical to "no tracks found nearby".

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.6.0)
', '2026-06-15T02:25:18Z'::timestamptz),

  -- 14. v2.7.0
  ('v2-7-0-setup-history-gopro-chapters-and-post-session-data', 'v2.7.0 — Setup History, GoPro Chapters, and Post-Session Data', 'v2.7.0 is about the parts of a race weekend that are not the telemetry: what setup you ran, what the tyres measured afterwards, and the video you shot of it. Plus a proper answer to GoPro''s habit of chopping a recording into pieces.

### Setup and vehicle history

Every setup in the Garage now has a **history** icon opening a full-panel timeline of every saved revision. It starts with the original shown in full, then lists each later revision as a **diff** — only what changed, green when a number went up and red when it went down. Every revision shows the fastest lap run on it, the revision holding the overall fastest lap is highlighted, and the history filters by kart and course.

Vehicles got the same treatment. A vehicle''s history panel gathers every setup revision you have run on it, one card each, ordered fastest lap first so your quickest setup is on top. In both panels the fastest-lap time and each session in a card''s list are **tappable** — they load that session straight into the viewer, so you go from "which setup was quickest" to the actual telemetry in one tap.

You can also now **edit your vehicle types**. Renaming a field is always safe; if an edit removes a field or flips its data type while existing setups hold values there, a warning lists exactly which fields are affected and cancelling rolls the risky changes back, highlighted in orange.

### GoPro chunked video

GoPro cameras split one recording into sequential 3–5 minute files. You can now select **all** the chapter files at once and they play back — and sync to your telemetry — as one continuous video. Chapters are auto-detected and ordered, the next one is preloaded so the boundary is near-seamless, and a small chapter indicator shows where you are. Entirely client-side and offline; no stitching tool needed. Saved playlists reload automatically next session.

On mobile, where the file picker cannot be filtered, selecting *everything* still works — sidecar `.LRV`/`.THM` files, photos, and other junk are silently ignored. **Video export stitches across chapters too**, seeking the whole virtual timeline and concatenating each chapter''s audio in sync (multi-chapter export needs WebCodecs, so Chrome or Edge).

### Notes, Setups, and post-session measurements

Session notes and vehicle setups moved out of the Garage drawer and onto the **main toolbar** as their own tabs — they update often, so they should be one tap away. On tablets and desktop they share a single 50/50 **Setups & Notes** tab; phones keep them separate and full-width. Vehicles stay in the Garage, since you set those up once.

A new collapsible **Post-Session** panel on the Notes tab records the tyre pressures you measured after a run (single, halves, or quarters) plus a post-session weight, saved with the session and cloud-synced like your notes.

### Also

- **Fonts work fully offline now.** Inter and JetBrains Mono were loaded from Google''s CDN with no offline cache rule, so a fresh load at the track with no signal fell back to system fonts. They are self-hosted and precached now, which also removes a third-party request from every page load.
- **Weather is cached per session.** A session''s date never changes, so its weather is fixed — reopening shows the saved conditions instantly instead of re-querying the station.
- **Sample data is now just a normal log** in your file browser, with a **Show sample files** toggle in Settings.
- **The track manager is a simple drill-down**: tracks → tap one → its courses, with search once you have more than ten.
- Admin gained a **Users** tab with the ability to grant free months of premium, and a **storage trim warning** now counts down before over-limit cloud logs are trimmed.
- The experimental **Labs tab was removed** — it carried no active features.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.7.0)
', '2026-06-19T05:37:20Z'::timestamptz),

  -- 15. v2.7.1
  ('v2-7-1-course-editor-and-video-panel-polish', 'v2.7.1 — Course Editor and Video Panel Polish', 'A small polish release, cleaning up two rough edges left by recent work: the course editor now hides the Major toggle once all three major sectors are assigned, and the empty video panel stopped clipping its hints on narrow screens.

- **Course editor sector toggles.** Once all three major sectors are assigned (start/finish counts as one), the **Major** toggle is now hidden on the remaining sub-sector rows. The datalogger only ever uses three majors, so there is nothing left to promote them to. Un-flag an existing major and the toggles reappear immediately.
- **Video panel hints.** The "no video loaded" panel now pads its hint text so the GoPro tip does not clip against the panel edges on narrow screens, and it adds a second tip worth knowing: you can drop in **all** your files at once — logs and videos together — and the app works out which videos go where.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.7.1)
', '2026-06-19T16:33:55Z'::timestamptz),

  -- 16. v2.7.2
  ('v2-7-2-moving-to-lapwing', 'v2.7.2 — Moving to LapWing', 'Heads up: the site is moving. hackthetrack.net is becoming **LapWing** at **lapwingdata.com**, and this release exists to make sure nobody loses their data in the process.

Because your files are stored in your own browser, and browser storage is scoped per domain, **they do not carry over to the new address by themselves**. So a banner now appears on hackthetrack.net warning of the **July 20, 2026** shutdown, with a one-click data export and — where accounts are enabled — a "create a free account" path so your data follows you via cloud sync instead.

The banner only appears on the old domain. If you are already on lapwingdata.com there is nothing to do.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.7.2)
', '2026-06-20T22:48:24Z'::timestamptz),

  -- 17. v2.8.0
  ('v2-8-0-hello-lapwing', 'v2.8.0 — Hello, LapWing', 'The rename is done. The app is **LapWing** now, everywhere, and it lives at **lapwingdata.com**. Canonical URLs, the sitemap, social tags, and every in-app link have moved with it. The beta build lives at beta.lapwingdata.com.

### Android groundwork

The same frontend can now also serve a **native Android app**, built with Tauri in a separate repository, while the web app is unchanged. A new platform layer gates the native-only behaviour: the service worker is skipped inside the native WebView, external links open in the system browser, and — to comply with Google Play''s billing policy — paid plans are not sold or managed in-app. Cloud **sync still works** on native; subscriptions are just purchased and managed on the web.

### Import your data

Profile → Data & privacy gained an **Import data** option that restores files and garage data from a previously downloaded export ZIP. This is the migration path when moving between origins — the old hackthetrack.net site to lapwingdata.com, for instance — where per-browser storage does not carry over. Existing files are kept and matching names are skipped, and it works whether you are signed in or out, because it is a local restore.

### Account deletion from the web

A no-login page at **/delete-account** lets you request permanent deletion of your cloud account without signing in, which Google Play requires as a public URL. The existing in-app flow under Profile → Data & privacy is unchanged.

The Privacy Policy and Terms were updated to describe the Android app''s web-only billing, the public deletion URL, and the app''s foreground-only location use.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.8.0)
', '2026-06-20T23:40:39Z'::timestamptz),

  -- 18. v2.9.0
  ('v2-9-0-the-logger-picker-mychron-wi-fi-downloads-and-a-purple-repaint', 'v2.9.0 — The Logger Picker, MyChron Wi-Fi Downloads, and a Purple Repaint', 'LapWing stopped assuming your datalogger is a Fledgling. v2.9.0 introduces a generic logger-connection layer, a picker to choose which device you are pulling from, and the first non-Bluetooth download path — AiM MyChron over Wi-Fi in the native app. It also picked up a new coat of paint.

### One interface, many loggers

Downloads now go through a single `LoggerConnection` interface — list logs, download a log, disconnect — with the Web Bluetooth transport as one adapter behind it. That is the seam future loggers plug into without the download UI having to branch on transport.

"Download from logger" now opens an **image-based picker**: **PerchWerks Fledgling** (DIY, Bluetooth), **AiM MyChron 5 / 5S / 2T** (Wi-Fi, native app required), and **Alfano 6 / 7** (Bluetooth, coming soon). The picker is deliberately *eager* — it was split out of the lazy Bluetooth chunk into a lightweight host, so the button opens the menu instantly instead of waiting on (and silently failing when) the BLE chunk stalls. The heavy BLE flow still loads lazily, once you pick the Fledgling.

### MyChron over Wi-Fi

In the native Android app, the MyChron tile now runs a real download: connect over Wi-Fi (Android prompts you to pick the MyChron in the system dialog), list the sessions on the device, and download and open the one you choose. The web app is unchanged, since browsers cannot reach the logger''s Wi-Fi, and still shows the explanatory dialog. A native-only **Settings → MyChron** field lets you set the Wi-Fi name prefix the system picker filters on.

### Purple, and a new logo

The brand accent moved from teal to **purple**, in both light and dark, and the gauge glyph in the headers was replaced with the new **LapWing logo**, pairing with the refreshed app icons and favicon. Data-visualisation colours — the speed and telemetry scales — are unchanged, because those mean something.

### Also

- **A password strength checker on sign-up**: at least 8 characters with a lowercase letter, an uppercase letter, a number, and a symbol, with a live meter and per-rule checklist. Fully offline.
- **An "update available" check that does not rely on the service worker**, comparing the running build against a freshly-fetched `version.json`, so a stale tab reliably surfaces the prompt even when the SW''s own detection stalls behind CDN caching.
- **Separate cloud and local storage bars** in the profile.
- **Safe-area padding on native and installed PWAs**, so chrome no longer sits under the phone''s status bar or notch.
- **Sticky headers** across the landing and auth/legal pages, so the Login button is always reachable.
- **A login rate-limiter fix.** The limiter counted *every* sign-in attempt, successes included, as a failure — so after five tries an IP was locked out for an hour even with the correct password. It now only counts genuine failures, clears on success, and ages them out over a 15-minute sliding window.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.9.0)
', '2026-06-22T03:12:46Z'::timestamptz),

  -- 19. v2.9.1
  ('v2-9-1-offline-first-said-out-loud', 'v2.9.1 — Offline-First, Said Out Loud', 'A tiny release, mostly about wording — the landing hero stopped calling itself online when the whole point is that it is not, and the compatibility dialog learned it might be running on a phone rather than in a browser tab.

- **The landing hero dropped "Online" from the main heading** — it is an offline-first app and the heading was working against it — and added a line making the point directly: "Works entirely offline now that you''ve visited it!"
- **The compatibility dialog is device-aware.** On the native app the "Browser Compatibility" button and title now read **Device Compatibility**, and the list gained a **Wi-Fi Datalogger (MyChron)** row, shown as unavailable in the browser (it needs the native app) and supported on native.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.9.1)
', '2026-06-22T05:12:13Z'::timestamptz),

  -- 20. v2.9.2
  ('v2-9-2-split-graphs-and-frame-by-frame-video', 'v2.9.2 — Split Graphs and Frame-by-Frame Video', 'v2.9.2 is a video and comparison release. You can now step a session one sample at a time with the video following exactly, put two laps side by side with their own graphs and their own footage, and — the big one — sync a video once and never touch it again.

### Split graphs

On tablet and larger, a **Split graphs** button splits the graph area into a draggable two-up view. Pick one of your enabled overlay laps and the right panel mirrors the main panel''s graphs for that lap, with a single playback control driving both, kept on the same point on track rather than the same point in time.

If a synced video is relocated into the graph stack and the chosen lap is from the current session, a **second video plays alongside it**, frame-locked to the main player, showing the same point on track in the comparison lap''s own footage. An out-of-session lap shows graphs only, leaving the main video untouched.

### Frame-by-frame stepping

Two new buttons flank the play button to step the data cursor one sample back or forward, with a synced video following through the same sync path and landing on the exact frame. Drivers and coaches can now compare a lap literally frame by frame.

### Video sync is anchored to absolute session time

Sync a video once and it stays put. Switching laps or cropping the range never needs a re-sync, because the app now understands where the footage sits on the session timeline. That also means **partial videos** are handled cleanly: when the camera started after the logger or stopped before the session ended, the out-of-footage stretches show "Video starts later" or "Video ended" while the charts keep playing.

### Video playback stopped juddering

Three separate causes, all fixed:

- **Playing with a video loaded stuttered** because the video''s playhead lived in the shared session state, so every video frame re-created the whole session context and re-rendered every tab and panel 30–60 times a second. The playhead now lives in its own tiny context.
- **The top play button used to advance the cursor on its own clock and *seek* the locked video to chase it** — and every seek forces the decoder back to a keyframe. It now drives the video itself when it is locked over footage, with the cursor derived from the video''s playhead.
- **Scrubbing fired a fresh seek every frame** regardless of whether the previous one had finished, so the decoder thrashed, and a fixed throttle dropped the final seek and parked the video on a stale frame. Seeks are now paced on the video''s own `seeked` event — fast approximate seeks during the drag, one precise seek once the cursor settles.

The comparison video also stopped drifting lap by lap. A single sync offset cannot absorb a camera/logger **clock-rate** difference, so far-from-sync laps drifted by seconds. Sync is now rate-aware: a **± nudge** in 50 ms steps fine-tunes one lap, and **✓ Lock in** turns that into a calibration anchor, fitting the clock rate through it and applying it to every lap automatically.

### Also

- The Pro tab''s side panel can be **collapsed on any screen size** now, not just phones.
- **"Continue with Google" sign-in was removed** — it routed through a third-party hosted OAuth broker — pending a native Supabase Google setup. Email sign-in is unaffected. No public backend credentials ship in the repo anymore, so a fresh clone runs fully offline-first until you supply your own.
- **Approving a track submission now actually adds it to the database.** Approval previously only flipped a status flag, so an approved new track silently never appeared in the live tables.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v2.9.2)
', '2026-06-25T04:59:55Z'::timestamptz),

  -- 21. 3.0.0
  ('v3-0-0-leaderboards-and-public-driver-profiles', 'v3.0.0 — Leaderboards and Public Driver Profiles', 'Until v3.0.0, LapWing was a private tool: your logs, your garage, your device. This release opens a public side to it. There are now community leaderboards you can browse without an account, and every driver gets a shareable profile page.

### Leaderboards

A new public **Leaderboards** page lets anyone — signed in or not — browse the fastest community laps by **track → course → engine class**, with an optional **Group by weight** toggle and a **Show top** selector (3, 10, 25, 50, 100, or All).

Picking a group launches the normal telemetry viewer in a new **read-only mode**: an alert-coloured header, with Coach, Tools, Setups, video, weather, and snapshots hidden. Every submitted lap is a row, fastest first, labelled by the submitter''s name. So a leaderboard is not a table of numbers — it is a stack of real laps you can overlay and compare.

### Submitting a lap

From the Profile tab, signed-in users with lap snapshots get a **Submit to leaderboards** dialog. What goes public is deliberate: **GPS, engine name, and a listed weight** are public; **engine-telemetry channels** like RPM and temperatures stay private unless you opt in; and **setup data is never uploaded at all**. The listed weight defaults to your vehicle''s weight and can be overridden to show a class weight instead.

Custom tracks ride along with a snapshot so others can view the lap, and are automatically submitted to the community track database for review.

### Public driver profiles

A new `/driver/{name}` page — shareable, viewable signed-out, case-insensitive — shows a driver''s **profile picture**, display name, their **opt-in vehicles** (name, type, and engine only, never weights or setups), and their uploaded snapshots as cards. Click a driver''s avatar on the leaderboards to open their profile, and click any snapshot card to load that lap in the read-only viewer.

Profile pictures are cropped to a centred square and downscaled to 256px **on your device** before upload. Each vehicle in the garage has a **Show on profile** toggle that publishes a public-safe projection.

### Moderation

A new admin **Leaderboards** tab lists every submission with approve/deny (allow by default), a per-record engine **class override**, and admin notes. Engine **classes** are keyword groups that collapse free-text engine names — "Tillotson 225", "225RS", "Tilly" — into one class automatically, without ever mutating the user''s raw engine string.

### Also

- **An engine is now required on every vehicle**, since it drives leaderboard grouping and snapshot matching. Existing engine-less vehicles are flagged in the garage.
- **Display names are unique case-insensitively** now, so a name cannot be impersonated by changing case.
- **Leaderboard names update live** — a submitter''s name comes from their current profile rather than a copy frozen at submit time, so renaming updates all your existing entries.
- **Alfano groundwork.** Picking the Alfano tile now explains that it transfers over Bluetooth serial, which browsers cannot access, so it will require the native app. The native-side flow is scaffolded.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/3.0.0)
', '2026-06-30T04:26:53Z'::timestamptz),

  -- 22. v3.1.0
  ('v3-1-0-the-firmware-simulator', 'v3.1.0 — The Firmware Simulator', 'The headline of v3.1.0 is a page that has no business working as well as it does: **/simulator** runs the real DovesDataLogger firmware in your browser, on a simulated 128×64 OLED, replaying a real session.

Not a mock-up and not a video. The actual firmware, compiled to WebAssembly, booting on a canvas display and replaying the bundled Orlando Kart Center sample: acquiring GPS, auto-entering race mode, detecting the track, and counting laps exactly as the physical device does. The same wasm core reproduces that session''s 13 hardware lap times **to the millisecond**.

Three on-screen buttons (plus ← Enter →) drive the real firmware menus, even mid-playback. There is play/pause, 1–10× speed, a scrubbable timeline, an integer-scale zoom picker, and a true-size toggle showing the display at its physical 1.3 inches. Rewinding actually re-boots the firmware and fast-replays, because it is a real device and not a video file. Fully offline-capable.

The vendored build is pinned by construction — the firmware SHA, the DovesLapTimer SHA, and display library versions all travel with it — and it renders byte-identically to the firmware repository''s golden fixtures. This release updates it to firmware **v3.0.0** (build `ecc88c3`), which passed the sim''s node smoke test before vendoring.

The page also carries a **glossary of the firmware''s menu and system pages** — boot splash, GPS status, main menu, race mode, session review, BLE/USB transfer, camera pairing, SD format, warnings and faults, the charging screen — so you can see the full feature set including the pages that need real hardware, and a short explainer of what the device is actually doing during playback.

### Silent auto-update on an idle home page

When a new build is detected and you are not in the middle of anything — home page, no session loaded — the app now applies the update itself: a brief "Updating…" toast, an automatic reboot onto the new version, and a confirmation on the fresh load. No more mystery refresh that eventually flashes into a new build. Mid-session, or on any other page, the existing "Update ready" toast is shown instead, so a loaded session is never yanked away. A per-commit guard prevents reload loops if an update fails to stick.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v3.1.0)
', '2026-07-19T20:45:42Z'::timestamptz),

  -- 23. v3.1.1
  ('v3-1-1-pill-alignment-calculator-and-this-very-blog', 'v3.1.1 — Pill Alignment Calculator and This Very Blog', 'Two additions in v3.1.1: a proper alignment calculator for OTK-style eccentric kingpin pills, and the Updates page you are currently reading.

### Pill alignment tool

A new Tools-tab calculator for eccentric kingpin pills. Set top and bottom pill size and rotation per side and read camber, caster, and track width instantly. Explore the full reachable camber–caster envelope on an interactive scatter — drag the marker and it solves back to pill angles — or use **Find Setup** to get ranked pill combinations for a target alignment. When a target is outside what the pills can physically reach, it falls back to the closest achievable setting and says so, rather than shrugging, so you always get an answer.

It handles hole snapping, toe entry with an overhead toe visual, a resultant-toe colour mode, and a "load from session setup" shortcut. Chassis constants live in a modular profile system with built-in brand profiles — OTK/Tony Kart, Kart Republic, CompKart, Birel ART, Praga, Sodi — which are estimated until measured, plus measurement helpers that turn dial-indicator and gauge readings into constants you can save as your own named measured profile. Works offline and from the homepage Tools drawer.

### The Updates blog

This page. Articles from the team — release notes, news, and engineering write-ups — each at its own `/updates/<slug>` URL. Posts support Markdown with headers, bold, links, and image embeds, plus tags with filtering on the index and an "AI-assisted" marker where relevant. An **RSS feed** (subscribe link on the index, plus browser autodiscovery) lets you follow new posts.

The home page''s hand-maintained roadmap list is gone, replaced by a **Latest updates** section: two tap-through panels showing the newest release post and the newest other news, with a button through to the full page. It hides itself offline or when nothing is published.

### Simulator: load your own log

The `/simulator` page gained a session picker, so you can feed the firmware any dove-family log (`.dovex`, `.dovep`, `.dove`) instead of only the bundled demo, with a one-tap "Back to demo". Picked files are parsed leniently — a log whose metadata header was never written, because the session was not ended on the logger, still replays as long as the CSV column headers are intact. Handy for reproducing on-device bugs in a browser.

### Fixed

**Headerless `.dovex` files now load.** If a session was never "ended" on the logger, the reserved metadata header is left as blank padding, and the file used to be mis-detected as an Alfano CSV. Detection now recognises a padding-only preamble followed by valid Dove GPS data as `.dovex` and parses the session normally — driver and course metadata is simply absent, and in-app auto track detection takes over.

[Full release notes on GitHub](https://github.com/TheAngryRaven/DovesDataViewer/releases/tag/v3.1.1)
', '2026-07-26T02:24:39Z'::timestamptz)
) as v(slug, title, body, published_at)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Verify: expect 23 rows, newest first.
-- ---------------------------------------------------------------------------
-- select published_at, slug, title, tags, published from public.posts order by published_at desc;
