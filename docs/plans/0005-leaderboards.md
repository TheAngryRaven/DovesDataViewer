# Plan 0005 — Leaderboards

## Context

Dove's DataViewer / LapWing already lets a driver freeze a "course fastest lap"
as a **snapshot** (`lib/lapSnapshot.ts`) — GPS samples ±5 s, frozen course
geometry, engine string, and a copy of the vehicle/setup. Snapshots are
per-(course, engine), immutable, and already cloud-synced (`lap_snapshots`
table). They are the perfect unit for a **community leaderboard**: each one is a
single verified lap with everything needed to compare and replay it.

This plan adds a public **Leaderboards** feature: users opt-in submit their
snapshots; anyone (signed-in or not) can browse tracks → courses → engine/weight
groups; clicking a group launches the existing telemetry viewer in a new
**read-only mode** showing every entry as a lap (fastest = lap 1). Admins get a
moderation panel (approve/deny, default-allow) plus an engine **classification
system** so "Tillotson 225" / "225RS" / "Tilly" collapse into one group without
touching user data.

Built almost entirely inside the existing **cloud-sync plugin** + **admin panel**
+ a new **`/leaderboards`** route, reusing the modular session/viewer pipeline.

### Decisions locked with the maintainer
- **Privacy:** GPS, engine name/class, and the **listed weight** are always
  public. **Setup sheet** and **engine-telemetry channels** (`rpm`, `water_temp`,
  `oil_temp`, `egt`, `temp_1`, `temp_2` — the Engine/sensors group in
  `channels.ts`) are **hidden by default**, each with an opt-in "share publicly"
  toggle.
- **Weight:** comes from the vehicle's existing `weight`/`weightUnit` (`Kart` in
  `kartStorage.ts`). Snapshot save must start capturing it. At submission the
  **"Listed weight"** (public, groups exact-match) defaults to the vehicle weight;
  the user may override it (privacy — e.g. show 365 lb when they're really 375).
  If the vehicle has no weight, a Listed weight is **required** (non-zero) to
  submit. (Term: **"Listed weight"**, not "mask weight".)
- **Entry volume:** the Leaderboards page has a **"Show top"** selector
  (3 / 10 / 25 / 50 / 100 / All, default **50**) controlling how many entries a
  group loads into the viewer — user can choose to overload their own machine.
- **Viewer delivery:** **reuse the main viewer** (`Index.tsx`) via an in-app
  handoff; no separate viewer page, not URL-shareable in v1.

---

## Part A — Data model (Supabase)

New migration `supabase/migrations/20260626000000_leaderboards.sql` (follow the
patterns in `20260529000000_lap_snapshots.sql` and `submissions`):

### Table `leaderboard_entries` — one row per submitted snapshot
Columns: `id uuid pk`, `user_id uuid → auth.users on delete cascade`,
`display_name text` (denormalized submitter profile name — the public label /
lap label, stable across renames), `track_name`, `course_name`, `course_key`,
`direction text null`, `engine text` (raw user string, never mutated),
`engine_key text` (normalized), `engine_class_id uuid null → engine_classes`
(auto-set by classifier, **admin-overridable** — the grouping key),
`listed_weight numeric`, `listed_weight_unit text` (`'lb'|'kg'`),
`lap_time_ms integer`, `content_hash text` (anti-resubmit),
`setup_public boolean default false`, `engine_telemetry_public boolean default false`,
`data jsonb` (clean-lap samples + frozen `Course` + `lapStartMs/lapEndMs`
[+ `setup` only when `setup_public`]; engine-telemetry channels stripped from
samples + fieldMappings unless `engine_telemetry_public`),
`status text default 'approved' check (status in ('approved','denied'))`,
`created_at`, `reviewed_at`, `reviewed_by uuid null`, `admin_notes text null`.
- `unique (user_id, content_hash)` — a user can't resubmit an identical snapshot.
- Indexes: `(course_key)`, `(status)`, `(engine_class_id)`.
- **RLS:** `select` to `anon, authenticated` where `status='approved'`; `insert`
  to `authenticated` with `auth.uid()=user_id`; `delete` own (withdraw); admins
  (`has_role(auth.uid(),'admin')`) `select` all + `update` (status / class /
  notes). No user UPDATE.

### Table `engine_classes` — admin-managed classification
Columns: `id uuid pk`, `name text` (canonical display, e.g. "Tillotson 225"),
`keywords text[]` (substrings matched case-insensitively against `engine_key`),
`sort_order int default 0`, `created_at`, `updated_at`.
- **RLS:** `select` to `anon, authenticated` (labels + grouping); all writes
  admin-only.

### Classification (server-side, automatic)
- SQL helper `classify_engine(p_engine_key text) returns uuid` — first
  `engine_classes` row whose any keyword is a substring of the key (ordered by
  `sort_order`), else null.
- BEFORE INSERT trigger on `leaderboard_entries`: if `engine_class_id` is null,
  set it via `classify_engine(NEW.engine_key)`.
- Admin RPC `reclassify_entries()` (SECURITY DEFINER, admin-guarded) re-runs
  classification across rows whose class was never admin-set — call after editing
  classes. (Track admin-set vs auto via a nullable `class_locked boolean` or a
  `reviewed_by`/explicit flag — use a `class_source text default 'auto'` set to
  `'admin'` on override so reclassify skips locked rows.)

### Browse aggregates
For v1, **no custom aggregate RPCs**: the Leaderboards page selects only the
**light columns** (everything except `data`) where `status='approved'` and
aggregates client-side into the accordion (track list, course list, engine/weight
groups, counts, fastest lap). Fetch `engine_classes` once for labels. Only when a
group is opened do we re-query the chosen rows **with `data`**, ordered by
`lap_time_ms asc`, `limit <Show-top N>`. Note this in the plan as the scaling
seam — promote to RPCs/materialized view if volume explodes.

### `config.toml`
No new edge function needed (submission is a direct RLS insert, mirroring how
`cloud-sync` already inserts `lap_snapshots`). Moderation rides RLS admin
policies through the existing DB layer.

---

## Part B — Snapshot capture gains weight

- `lib/lapSnapshot.ts`: extend `SnapshotVehicle` with `weight?: number` and
  `weightUnit?: "lb" | "kg"`. No behavior change otherwise.
- `hooks/useLapSnapshots.ts` (~line 122): include `weight`/`weightUnit` when
  building the `vehicle` object passed to `buildSnapshot`.
- Pure-logic test in `lib/lapSnapshot.test.ts` covering the new fields.
- No `DB_VERSION` bump: snapshots are stored as jsonb (IndexedDB `lap-snapshots`
  + cloud), so the added field is forward/back compatible.

---

## Part C — Submission (cloud-sync plugin, Profile tab)

New first-party content under `src/plugins/cloud-sync/`:

- **`leaderboardClient.ts`** — untyped table access mirroring `cloudClient.ts`
  (`supabase.from("leaderboard_entries")`, `engine_classes`), plus `fetchMyEntries`,
  `submitEntries(rows)`, `withdrawEntry(id)`.
- **`lib/leaderboardSubmission.ts`** (pure, unit-tested):
  - `contentHashForSnapshot(snap)` — stable hash over immutable identity
    (`lapTimeMs` + `recordedAt` + `courseKey` + sample count + first/last coords).
    Reuse the FNV-1a approach already in `lib/trackSubmission.ts`.
  - `buildEntryPayload(snap, { setupPublic, engineTelemetryPublic, listedWeight,
    listedWeightUnit, displayName })` — trims samples to the clean lap
    (`snapshotLapSamples`), strips the engine-telemetry channel group from samples
    + `fieldMappings` unless shared, drops `setup` unless shared, returns the
    `leaderboard_entries` row.
- **`LeaderboardSubmitPanel.tsx`** — a new `PanelSlot.Profile` panel (register in
  `cloud-sync/index.ts` alongside `StoragePanel`/`LapSnapshotsPanel`). Visible only
  when signed in **and** `listSnapshots()` returns ≥1. Shows a **"Submit to
  leaderboards"** button → dialog listing each snapshot with: per-snapshot
  **Listed weight** (prefilled from `snap.vehicle.weight`, required if missing),
  **Share setup** toggle (default off), **Share engine data** toggle (default off),
  and a persistent notice that **GPS, engine, and weight are public**. Already-
  submitted snapshots (hash in the local submitted-set) show "Submitted" and are
  disabled.
- **Local submitted-set**: persist submitted content-hashes in the plugin KV store
  (`ctx.storage`, same idea as `trackSubmission`'s submitted records) so the UI
  can mark/disable resubmits offline, independent of the DB unique constraint.

---

## Part D — Browse page (`/leaderboards`)

- **Reusable header refactor:** extract the Landing sticky banner into
  `src/components/SiteHeader.tsx` (sponsor + settings slot + profile/sign-in, plus
  optional `showSupportedFiles` / `showAbout`). `LandingPage.tsx` renders it with
  both on; `Leaderboards.tsx` renders it with both **off**. Keeps Golden Rule #2
  (reuse) and guarantees the banners stay identical.
- **`src/pages/Leaderboards.tsx`** (lazy route, added in `App.tsx` above the
  catch-all, gated `{enableCloud && <Route path="/leaderboards" .../>}`):
  - Uses `useSettings()` for a standalone `<SettingsModal>` in the header; profile
    button navigates `'/'` with `state:{ openProfile:true }` (Index opens the
    profile drawer from that state — small addition to `Index.tsx`); sign-in →
    `/login`.
  - **"Show top"** selector (3/10/25/50/100/All, default 50) at the top.
  - **Accordion hierarchy** (shadcn `Accordion`, reusing the data-bubble styling
    already used elsewhere): **Track** rows (bubbles: engine count via class
    grouping, record count, track fastest lap) → expand to **Course** rows → expand
    to **engine/weight groups** with a **"Group by weight"** toggle (exact-weight
    match only). Empty state: "No submissions yet :(".
  - Group label = `engine_classes.name` when classified else raw `engine`
    (+ ` · <weight><unit>` when grouped by weight).
  - Clicking a group: fetch that group's rows **with `data`** (ordered fastest
    first, `limit N`), call `buildLeaderboardSession(...)`, push the bundle to the
    handoff store, `navigate('/')`.
- **Landing entry point:** add a **"Leaderboards"** `ActionTile` (Route icon) to
  the `LandingPage.tsx` action grid (gated `enableCloud`) → `navigate('/leaderboards')`.

---

## Part E — Read-only viewer (reuse `Index.tsx`)

- **`lib/leaderboardSession.ts`** (pure, unit-tested) —
  `buildLeaderboardSession(entries, course)` returns
  `{ data: ParsedData, course, selection, laps: Lap[], lapLabels: Record<number,string>, descriptor }`:
  - Concatenate each entry's clean-lap samples with **cumulative `t` offsets**
    (fastest entry first → lap 1).
  - One `Lap` per entry (`startIndex`/`endIndex`, `lapTimeMs`, speed stats);
    `lapLabels[lapNumber] = entry.display_name`.
  - Union all entries' `fieldMappings`; `bounds` via `calculateBounds`
    (`lib/parserUtils.ts`); set `dovexMetadata.lapTimesMs`.
  - `descriptor` = `{ courseName, engineLabel, weightLabel }` for the LapTimes
    header text.
- **`lib/leaderboardHandoff.ts`** — module-level singleton (same shape as
  `lib/fileLoadingState.ts`): `setPendingLeaderboardSession(bundle)` /
  `takePendingLeaderboardSession()` (consume-once).
- **`Index.tsx` read-only mode:**
  - On mount, `takePendingLeaderboardSession()`; if present, load its `data` via
    the existing `handleDataLoaded` path and set `readOnly=true` holding the
    injected bundle.
  - **Feed `SessionContext` from the injected bundle when `readOnly`** (laps,
    course, selection, plus new optional `lapLabels` + `readOnlyDescriptor` on
    `SessionContextValue`), bypassing the `useLapManagement` detection output —
    do **not** rewrite `useLapManagement`; just choose the source feeding the
    memo'd `sessionContextValue` (and the header lap dropdown). This keeps the
    concatenated multi-driver samples from being re-lap-detected.
  - **Header:** alert/warning chrome via the existing `--warning` token (same
    token the preview-build footer uses) + a "Read-only leaderboard view" label
    and an **Exit** button (`navigate('/leaderboards')`).
  - **Hide/disable when `readOnly`:** Coach / Tools / Setups&Notes tabs (extend
    the `showCoach && …` pattern in the `TabBar`), the **snapshots** button
    (`LapSnapshotControls`), **video** (skip the `VideoPlayer` mount / `useVideoSync`
    load), and **weather** (skip `onWeatherStationResolved` / weather UI).
  - **Lap labels:** in the header lap `<Select>` and in `LapTable.tsx`, render
    `lapLabels[lap.lapNumber] ?? "Lap N"` instead of the bare number (read
    `lapLabels` from `SessionContext`; falls back to the number when absent, so
    normal sessions are unchanged).
  - **LapTimes header text:** when `readOnlyDescriptor` is present, render a line
    above the table — course name, engine class, weight class — using the empty
    top space in `LapTimesTab`/`LapTable`.

---

## Part F — Admin panel

- **DB layer** (`src/lib/db/types.ts` + `supabaseAdapter.ts`): extend
  `ITrackDatabase` with leaderboard methods — `getLeaderboardEntries(filter)`,
  `updateLeaderboardEntry(id, { status?, engineClassId?, adminNotes? })`,
  `getEngineClasses()`, `createEngineClass`/`updateEngineClass`/`deleteEngineClass`,
  `reclassifyEntries()`. All run under the admin RLS policies / RPC.
- **`src/components/admin/LeaderboardsTab.tsx`** — new admin tab (register in
  `Admin.tsx` tab list, mirroring `SubmissionsTab`): list entries with filters
  (status / track / engine), per-row **Approve/Deny**, **engine-class override**
  dropdown (sets `class_source='admin'`), and `admin_notes`. Shows `display_name`,
  raw `engine`, listed weight, lap time. A small map/lap preview is optional v1.
- **`EngineClassesTab.tsx`** (or a section within LeaderboardsTab) — CRUD for
  `engine_classes` (name + keyword list) and a **"Reclassify"** button →
  `reclassifyEntries()`.

---

## Part G — Docs, changelog, tests

- **Plan doc:** save this as `docs/plans/0005-leaderboards.md`; cite `plan 0005`
  in every related commit (Golden Rule #8).
- **CHANGELOG.md:** open a new beta heading `## [2.10.0] - unreleased` (latest
  released is `2.9.2`; maintainer confirms the number) and add the user-facing
  Leaderboards entry there, appending as work lands (Golden Rule #4).
- **Docs in sync (Golden Rule #5):** `docs/backend.md` (new tables, RLS,
  classification), CLAUDE.md architecture map (new route/page, cloud-sync panel,
  admin tab, `leaderboardSession`/`leaderboardHandoff`/`leaderboardSubmission`
  modules), `README.md` feature list. No new FOSS dependency → CreditsDialog
  untouched.
- **Tests (Golden Rule #3):** Vitest for the pure modules —
  `leaderboardSubmission` (hashing, payload trim/strip of setup + engine channels,
  listed-weight validation), `leaderboardSession` (cumulative offsets, one lap per
  entry, lap labels, fastest-first ordering), and the `lapSnapshot` weight capture.

---

## Files (representative)
- **New SQL:** `supabase/migrations/20260626000000_leaderboards.sql`
- **New libs:** `src/lib/leaderboardSession.ts`, `src/lib/leaderboardHandoff.ts`,
  `src/plugins/cloud-sync/lib/leaderboardSubmission.ts`,
  `src/plugins/cloud-sync/leaderboardClient.ts`
- **New UI:** `src/pages/Leaderboards.tsx`, `src/components/SiteHeader.tsx`,
  `src/plugins/cloud-sync/LeaderboardSubmitPanel.tsx`,
  `src/components/admin/LeaderboardsTab.tsx` (+ engine classes)
- **Edited:** `src/App.tsx` (route), `src/components/LandingPage.tsx` (SiteHeader +
  tile), `src/pages/Index.tsx` (read-only mode, handoff consume, open-profile
  state), `src/contexts/SessionContext.tsx` (`lapLabels`, `readOnlyDescriptor`),
  `src/components/LapTable.tsx` + `tabs/LapTimesTab.tsx` (labels + header text),
  `src/lib/lapSnapshot.ts` + `src/hooks/useLapSnapshots.ts` (weight capture),
  `src/lib/db/types.ts` + `supabaseAdapter.ts`, `src/pages/Admin.tsx`,
  `src/plugins/cloud-sync/index.ts` (register panel)

## Verification
- `bun run lint`, `bun run typecheck`, `bun run test:run`, `bun run build` all
  green (Golden Rule #6).
- New Vitest suites for `leaderboardSession`, `leaderboardSubmission`, snapshot
  weight pass.
- Apply the migration to the preview/beta Supabase; manual end-to-end on
  `bun run dev`:
  1. Assign a vehicle with a weight, snapshot a lap → snapshot carries weight.
  2. Profile → "Submit to leaderboards" → toggles default to private; submit;
     re-open shows "Submitted" and blocks an identical resubmit (unique hash).
  3. `/leaderboards` lists the track → course → engine/weight group with correct
     bubbles + "Group by weight" toggle; "Show top" changes loaded count.
  4. Open a group → main viewer in read-only mode: warning header, Coach/Tools/
     Setups hidden, no video/weather/snapshots; lap list + LapTable show submitter
     names; LapTimes header shows course/engine/weight; lap 1 is the fastest.
  5. Admin → Leaderboards tab: deny an entry (drops from public list), override
     its engine class (regroups), edit engine classes + reclassify.
