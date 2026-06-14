# Plan: Internationalization (i18n) / translation system

Status: **Phase 7 — auth pages + entire landing page complete** · current branch: `claude/i18n-file-import` → PR into `BETA`

> **Phase 7d (this PR):** the landing page's primary **file drop zone**
> (`FileImport`, "Open a datalog") — heading, drag/drop prompt, the
> locally-processed format note (`<Trans>`; format list stays literal), progress
> + error/loaded lines — in the `landing` namespace (`fileImport.*`). With this
> the whole landing page is localized. **Remaining overall:** the **admin** panel.

> **Phase 7c (this PR):** the last three landing-page dialogs — **Credits**
> (`CreditsDialog`), **Contact** (`ContactDialog`), and **browser-compatibility**
> (`BrowserCompatDialog`) — in the `landing` namespace. Open-source library names
> + their GitHub links stay literal (Credits data is untranslated by design);
> contact category **values** stay English (the submitted/admin key) while their
> labels are translated. `lib/browserCompat.ts` was refactored to return stable
> feature/status **ids** (typed unions) so the dialog translates them, keeping the
> lib i18n-free. **Remaining overall:** the **admin** panel only.

> **Phase 7b (this PR):** the two remaining landing-page content dialogs —
> **About** (`AboutDialog`) and **Supported Files** (`SupportedFilesDialog`) —
> added to the existing `landing` namespace (`about.*` / `supportedFiles.*`).
> Rich-text bodies use `<Trans>`; format names, file extensions (`.dove`, …) and
> brand/library links (DovesDataLogger, libxrk) stay literal. The feature list is
> an array via `returnObjects`. **Still untranslated on the landing page:** the
> Credits, Contact, and browser-compatibility dialogs (Credits is mostly library
> names; deferred). **Remaining overall:** the **admin** panel.

> **Phase 7 (this PR):** the **auth pages** — `Login`, `Register`,
> `ForgotPassword`, `ResetPassword`, `AuthCallback` — a new host `auth` namespace
> (`src/locales/<lng>/auth.json`, wired into `config.ts` NAMESPACES, the bundled
> English in `index.ts`, and the typed resources in `types/i18next.d.ts`). Covers
> every visible string + toast/validation message + `useDocumentHead` titles; the
> age-confirmation line with its Terms/Privacy links uses `<Trans>`. Brand
> ("HackTheTrack") stays literal. **Remaining:** the **admin** panel (env-gated,
> `VITE_ENABLE_ADMIN`). (Legal pages stay English by design.)

> **Phase 6, slice 2 (merged):** the **Tools plugin**, translated
> **plugin-locally** — `ToolsPanel`, the `toolList` catalog labels, and the
> seat-position visualizer (`SeatPositionTool` + `SeatDiagram`). Unlike every
> prior surface, the strings live in the plugin's *own* folder
> (`src/plugins/tools/locales/<lng>.json`, namespace `tools`) and register via a
> new host seam `registerPluginLocale` (`lib/i18n/pluginLocales.ts`): English
> eager via `addResourceBundle`, other languages lazy-imported from the plugin
> dir through the backend's `read` hook (still offline-precached). Keys are typed
> off the plugin's own `en.json` (`useToolsT`) and a plugin-local parity test
> guards them — so nothing about Tools depends on host locale files, keeping it
> extraction-ready. cloud-sync stays host-coupled in the shared `plugins`
> namespace. **Remaining:** auth/admin. (Legal pages stay English by design.)
>
> **Follow-up (deferred, low priority):** retrofit **cloud-sync** onto the same
> plugin-local seam (`registerPluginLocale`) so its strings live in
> `src/plugins/cloud-sync/locales/` too. The translation *content* already exists
> (just moves from `src/locales/<lng>/plugins.json`), so this is mechanical — the
> one wrinkle is that the `plugins` namespace is **shared**: the host
> `PluginPanelHost` also owns `panelError`, the `loading` fallback, and renders
> the panel **titles**. So the retrofit must first **split** that namespace —
> keep the host chrome host-side (fold `panelError`/`loading` into `common`, let
> titles resolve cross-namespace) and move only the cloud-sync-owned keys into the
> plugin. Worth doing once the cloud-sync UI is itself further split out; skipped
> for now because cloud-sync is permanently host-coupled (never extracted), so it
> gains nothing from extraction-readiness today.

> **Phase 6, slice 1 (merged):** the **`plugins` namespace**, cloud-sync slice —
> every cloud-sync Profile panel (`StoragePanel`/Account, `LapSnapshotsPanel`,
> `CloudLogsPanel`, `DataPrivacyPanel`), the per-file `FileSyncToggle` +
> `FileDeleteToggle` mounts, and the two non-React modules (`autoSync` quota/
> offline notices + `accountExport` progress phases) via direct `i18n.t`. Panel
> **titles** are now i18n keys: `PluginPanelHost` resolves `t(panel.title)` at
> render (a literal non-key title falls through unchanged), so the host's error/
> loading chrome is translated too. **Remaining:** the **Tools** plugin slice
> (`ToolsPanel`, `toolList`, the seat-position visualizer) and then auth/admin.
> (Legal pages stay English by design.)

> **Phase 5 (merged):** the **`tracks` namespace** — the track/course editor +
> manager (`TrackEditor`, `AddTrackDialog`, `AddCourseDialog`, `SectorListEditor`,
> `VisualEditor`, `TrackPromptDialog`) and the community **submission** flow
> (`SubmitTrackDialog`). Sector numbering labels (from `sectorLabels()`) stay
> literal; the pure `courseSectors` validation strings + `deviceSettingsSchema`
> labels remain English data. With this the whole track-management surface is
> translated. **Remaining:** plugins/cloud (cloud-sync panels, Tools) and
> auth/admin. (Legal pages stay English by design.)
>
> (Phases 0–4 — engine + landing/Settings, core session UI, video, the full
> garage drawer, and weather — already merged.)

> **Garage sub-slice 3 (Phase 4):** Device — `DeviceSettingsTab`,
> `DeviceTracksTab`, `FirmwareUpdateSection` (`drawer.device`/`drawer.firmware`/
> `drawer.deviceTracks`) — **plus the catch-up `weather` namespace**
> (`WeatherPanel` + `LocalWeatherDialog`). Device-setting field labels stay
> sourced from `deviceSettingsSchema.ts` (data; unknown keys pass through) — a
> schema-level i18n pass is the deliberate follow-up. With this, the **whole
> garage drawer is translated.** **Remaining:** tracks (editor + community
> submission), plugins/cloud, auth/admin.
>
> (sub-slices 1 & 2 — shell+Files+Vehicles, Setups+Notes — already merged.)

> **Garage sub-slice 2 (this PR):** Setups + Notes — `SetupsTab`,
> `TemplateCreator`, `NotesTab`, and the shared `InfoBox` `SetupDetails` table
> (the tire/PSI/diameter labels deferred from Phase 2, now in `drawer.setupDetails`
> so they match `SetupsTab`). Tire position codes (FL/FR/RL/RR) stay literal;
> descriptive words are translated. **Remaining:** garage sub-slice 3 = Device
> (Settings/Tracks/firmware), then tracks, plugins, auth/admin.
>
> (sub-slice 1 — shell + Files + Vehicles — already merged.)

> **Phases 0–3 shipped:** engine + 6 languages + landing/Settings (`common`/
> `landing`/`settings`); core in-session UI + live analysis views (`session`);
> video (`video`). **Phase 4 (this PR)** opens the **`drawer` namespace** and
> does the garage drawer's **shell + Files + Vehicles** sub-slice
> (`FileManagerDrawer` tab chrome incl. the Device connect/battery states,
> `FilesTab` + the shared `SessionBrowser`, `VehiclesTab`, `EngineCombobox`). The
> pure `fileBrowserTree` gained an optional labels arg so the UI passes
> translated `allSessions`/`untagged` while the module + its tests stay i18n-free;
> `KartsTab` is dead code and was skipped. **Remaining garage sub-slices:**
> Setups (`SetupsTab` + the shared InfoBox setup-detail table) and Notes, then
> Device (Settings/Tracks/firmware). After garage: tracks, plugins, auth/admin.
>
> One refinement vs. the original design: the source-of-truth
> English locales live in **`src/locales/en/`** (bundled as i18next `resources`
> — the zero-flash fallback + the typed key set), and the other languages are
> **dynamic-imported** from `src/locales/<lng>/<ns>.json` (Vite code-splits each
> into its own JS chunk, precached by the SW). This is simpler and equally
> offline vs. the `public/locales/` + fetch-backend sketch in §4 below — no
> separate `includeAssets` entry needed, and a single source location the seed
> script reads. The rest of the plan stands.

Origin: the app is English-only but serves an international sim-racing/karting
audience. We never planned for translation, so retrofitting it is a cross-cutting
overhaul. This document is the plan; no runtime code ships in the planning PR.

---

## Goal

Make every user-facing string translatable, ship **English** as the source of
truth, and **machine-generate** a first pass of other locales (re-runnable as
English changes) so they can be **hand-tuned** later by community/professional
translators. All of it must honour the project's hard constraints:

- **Offline-first (Golden Rule #1).** Translations must load and switch with no
  network — precached by the service worker like `tracks.json`.
- **Bundle budget.** Locale data must not ride the initial JS payload; only the
  active language loads, lazily.
- **Modular & reusable (Golden Rule #2).** One `t()` surface, namespaced keys,
  no scattered ad-hoc lookups.
- **Tested (Golden Rule #6).** Pure logic (key coverage, interpolation, the
  seeding script) ships with Vitest coverage.

---

## Decisions (locked with the user)

1. **Engine: `react-i18next` + `i18next`.** Mature, gives us
   plurals/interpolation/fallback/lazy-loading for free, first-class React hooks
   (`useTranslation`), and strong TS key typing. Heavy on paper (~40 KB gz) but
   **lazy-splittable** into its own vendor chunk so it never bloats the
   offline-first landing payload.
2. **Seeding: a committed LLM translation script.** A repo script translates
   `en/*.json` → each target locale using a motorsport glossary, marks each
   generated file `"_machine": true` (unreviewed), and is **re-runnable** as
   English drifts. Output JSON is committed (offline-first: no build-time API
   dependency, no runtime translation calls).
3. **Phase-1 target languages (the "top motorsport set"):** Spanish (`es`),
   French (`fr`), German (`de`), Italian (`it`), Brazilian Portuguese (`pt-BR`),
   Japanese (`ja`) — plus English (`en`) as source. Right-to-left scripts
   (Arabic/Hebrew) are explicitly **out of scope** for phase 1 (they need a
   bidi/layout pass).

---

## Why this is a big job (scope reality)

A codebase survey found **~3,100 user-facing string literals** across ~423
files, no existing i18n, mixed toast libraries (`sonner` + `@/hooks/use-toast`),
and ~80+ interpolated/pluralized strings. The text is concentrated:

| Area | Approx. strings | Notes |
|------|-----------------|-------|
| `components/drawer/` | ~1,130 | SetupsTab, DeviceTracksTab, FilesTab — highest density |
| `plugins/` (cloud-sync) | ~700 | StoragePanel, CloudLogsPanel, LapSnapshotsPanel, DataPrivacyPanel |
| `pages/` | ~460 | Privacy/Terms (legal — see risks), Register, Login |
| `components/video-overlays/` | ~350 | overlay labels + settings panel |
| `components/admin/` | ~290 | **gated behind `VITE_ENABLE_ADMIN`** — low priority |
| `components/` (top level) | ~500+ | SettingsModal, VideoPlayer, LandingPage, RaceLineView |

Top-heavy: the ~15 largest files hold ~64% of the strings. This drives the
**phased rollout** below — we don't extract 3,100 strings in one PR.

---

## Architecture

### 1. Dependencies

Add to `dependencies`: `i18next`, `react-i18next`. Add the ICU plurals path via
i18next's built-in plural rules (no extra package needed for phase 1; revisit
`i18next-icu` only if a locale needs full ICU select/ordinal). Update README
Credits **and** `CreditsDialog.tsx` (they must agree — Golden Rule #4).

### 2. Bundle split (critical for offline-first)

Add an `vendor-i18n` entry to `manualChunks` in `vite.config.ts`:

```ts
"vendor-i18n": ["i18next", "react-i18next"],
```

so it caches independently and is isolated from app code. The **init module**
(`src/lib/i18n/index.ts`) is imported once from `main.tsx`; locale JSON is **not**
bundled into JS at all — it lives in `public/locales/` and is `fetch`ed at runtime
(see §4), so only the active language's bytes ever load.

### 3. File layout

```
public/locales/
├── en/                 # source of truth (human-authored)
│   ├── common.json     # buttons, generic words, units glue
│   ├── settings.json   # SettingsModal
│   ├── drawer.json     # Files/Setups/Notes/Vehicles/Device tabs
│   ├── session.json    # in-session UI: laps, charts, maps, overlays
│   ├── video.json      # VideoPlayer + video-overlays
│   ├── tracks.json     # track editor, submission, course detection
│   ├── device.json     # BLE/device sync/firmware
│   ├── pages.json      # landing, privacy, terms, auth pages
│   ├── plugins.json    # cloud-sync, tools, coach-facing strings
│   └── admin.json      # admin (loaded only when admin flag on)
├── es/ fr/ de/ it/ pt-BR/ ja/   # machine-seeded, same namespace files
└── manifest.json       # { languages: [...], namespaces: [...] }

src/lib/i18n/
├── index.ts            # i18next init (lazy http backend + react binding)
├── config.ts           # SUPPORTED_LANGUAGES, NAMESPACES, fallback, types
├── i18n.test.ts        # key-coverage + load/fallback tests (pure)
└── format.ts           # Intl-based date/number/list helpers (see §7)

scripts/
└── seed-translations.mjs   # LLM seeding pipeline (see §8) + glossary
```

**Namespaces** map to load-on-demand surfaces: `common` loads eagerly (tiny);
the rest lazy-load when their surface mounts (drawer opens → `drawer`, video
opens → `video`, admin route → `admin`). This keeps the landing payload to
`common` + `pages` only.

### 4. Loading strategy (offline + lazy)

Use `i18next-http-backend` (tiny) pointed at `/locales/{{lng}}/{{ns}}.json`,
**or** a hand-rolled backend (zero extra dep) that `fetch`es the same path —
identical to how `trackStorage.ts` loads `/tracks.json`. The service worker
already precaches `**/*.json` via Workbox `globPatterns`, and we add
`"locales/**/*.json"` to vite-plugin-pwa `includeAssets` so every locale file is
in the precache manifest → **fully offline, no runtime download after first
install.** Decision in the PR: prefer the hand-rolled fetch backend to avoid a
dependency, since our loading is trivial.

`fallbackLng: 'en'` and `returnEmptyString: false` so any missing key falls
back to English rather than showing a raw key.

### 5. Provider placement

`react-i18next` works via context from a single `i18n` instance — no JSX
provider strictly required, but we wrap the tree in `<I18nextProvider i18n={…}>`
at the **top of `App.tsx`** (outside `BrowserRouter`, sibling to
`TooltipProvider`) so every route — including the lazy auth/admin pages and the
`Index` provider stack (Settings/Session/Playback) — sees the same instance.
Initialization (`src/lib/i18n/index.ts`) runs in `main.tsx` **before**
`createRoot`, mirroring `initDebugConsole()`/`initPlugins()`, and is awaited just
enough to set the initial language (read synchronously from localStorage, see
§6) before first paint to avoid an English flash.

### 6. Language as a setting

Language is a user preference, so it joins `AppSettings` in
`src/hooks/useSettings.ts` (persisted to `localStorage` under the existing
`dove-dataviewer-settings` key — no new storage):

```ts
language: SupportedLanguage; // default 'en'
```

- **Initial pick before render:** `i18n/index.ts` reads the settings blob from
  localStorage directly (same trick `App.tsx` already uses for `darkMode`) to set
  `lng` before React mounts — no flash, no async gate on first paint.
- **Auto-detect on first run:** if the user has never set a language, seed the
  default from `navigator.language` matched against `SUPPORTED_LANGUAGES` (falling
  back to `en`). Stored on first resolve so it's stable thereafter.
- **Switching:** a new **Language** picker in `SettingsModal.tsx` (a `Select`
  next to the units toggles) calls `setSettings({ language })`; a small effect
  bridges the setting to `i18n.changeLanguage(language)`. Document language is set
  on `<html lang>` for accessibility/SEO.

### 7. Locale-aware formatting (dates / numbers / units)

Today there is **almost no locale-aware formatting** — one `toLocaleString()` in
`lib/units.ts`, no `Intl`, no `toLocaleDateString`. File-browser timestamps use
ad-hoc `M/D/YYYY` formatting. i18n is the moment to fix this:

- New `src/lib/i18n/format.ts`: thin `Intl.DateTimeFormat` / `Intl.NumberFormat`
  / `Intl.ListFormat` wrappers keyed off the active language, **pure + tested**.
- Route file-browser/session date-time display through it (replaces the hand-rolled
  `M/D/YYYY h:mm A`).
- **Units stay a separate axis.** `lib/units.ts` already owns the three
  imperial/metric toggles (speed/distance/weather) and these are **deliberately
  independent of language** (a German user may still want MPH). i18n does **not**
  swap units; it only (a) translates the **unit labels/glue** where they appear in
  sentences and (b) localizes the **number formatting** (decimal comma vs point)
  inside `units.ts` formatters via `Intl.NumberFormat`. The unit symbols
  themselves (`km`, `°C`, `hPa`) are conventionally not translated — keep them
  literal, translate only surrounding words.

### 8. LLM seeding pipeline (`scripts/seed-translations.mjs`)

Re-runnable Node script (run manually / in a maintainer workflow, **never** in
the offline app or the standard CI build):

1. Read every `public/locales/en/*.json` (source of truth).
2. For each target locale, **diff** against the existing locale file: translate
   only **new or changed** English keys (English value hashed per key in a
   sidecar `*.hash` or inline `_meta`), preserving any keys a human has already
   hand-tuned (tracked by a per-key `_reviewed` set — machine output never
   clobbers a reviewed string).
3. Call the LLM (model id from env; **do not** hardcode/commit a key) with: the
   English strings, a committed **motorsport glossary** (`scripts/i18n-glossary.json`
   — e.g. "lap", "sector", "apex", "stint", "downforce", "setup", brand names
   that must stay verbatim), the target language, and ICU/interpolation rules
   ("preserve `{{var}}` placeholders and `<0></0>` tags exactly").
4. Validate output: same key set, all `{{placeholders}}` preserved, valid JSON,
   plural categories correct for the target language. Reject + report on mismatch.
5. Write the locale file with `"_machine": true` + per-file provenance so the UI
   can surface a discreet "machine-translated" hint and translators know what's
   unreviewed.

`npm run i18n:seed` wraps it. The **pure** validation/diff/placeholder-check
helpers live in `scripts/lib/` (or `src/lib/i18n/seedUtils.ts`) and are
**unit-tested**; the network/LLM call is the thin untested shell.

### 9. TypeScript key safety

Augment `react-i18next`'s `CustomTypeOptions` with the `en` resource shape so
`t('settings.language')` is **autocompleted and compile-checked**. Generate the
type from `en/*.json` (a `resources.d.ts`, refreshed by a tiny script or
`i18next-resources-for-ts`) so missing/renamed keys fail `tsc -b`. This makes
the four-workflow CI gate enforce key integrity for free.

---

## String extraction strategy

Mechanical and incremental — **per surface, not per repo**:

1. For a target component, replace each literal with `t('ns:key')` and add the
   key to the matching `en/<ns>.json`.
2. **Interpolation:** `` `Lap ${n}: ${time}` `` → `t('session:lapLine', { n, time })`
   with `"lapLine": "Lap {{n}}: {{time}}"`.
3. **Pluralization:** `` `${k} overlay${k===1?'':'s'}` `` →
   `t('session:overlayCount', { count: k })` with i18next plural keys
   (`overlayCount_one` / `overlayCount_other`, and language-specific categories
   for `pl`/`ru`/`ja` etc. handled by i18next's CLDR rules).
4. **Rich text** (links inside sentences, e.g. Privacy/Terms) uses the `<Trans>`
   component so markup stays in JSX while words move to JSON.
5. **Toasts:** unify the call sites — translate the message strings; keep dynamic
   payloads (filenames, error details) as interpolation values, not concatenated
   English. Error chains keep the device/API detail verbatim (untranslatable),
   wrapped in a translated frame: `t('common:syncFailed', { name, detail })`.
6. **Excluded from translation** (intentionally literal): canonical channel ids,
   unit symbols, brand/product names ("DovesDataLogger", "HackTheTrack"), file
   formats, console/debug logs, code-level errors not shown to users.

A lightweight lint guard (follow-up): an ESLint rule / CI grep to flag new
hardcoded JSX text in already-migrated directories, so we don't regress.

---

## Phased rollout

Each phase is its own PR into `BETA`, green on all four CI gates, with the
CHANGELOG updated (Golden Rule #7) once user-visible strings actually change.

- **Phase 0 — Foundation (this arc's first code PR).** Add deps + `vendor-i18n`
  chunk, `src/lib/i18n/*`, provider wiring, the `language` setting + SettingsModal
  picker, `public/locales/en/common.json` + `pages.json`, SW `includeAssets`,
  TS key typing, `format.ts`, and the **seeding script + glossary** (so locales
  can be generated from day one). Migrate **one** high-visibility surface end to
  end — the **landing page + SettingsModal** — as the reference implementation.
  Seed `es/fr/de/it/pt-BR/ja` for those namespaces. Tests: key coverage,
  interpolation, format, seedUtils.
- **Phase 1 — Core session UI.** `session` + `video` namespaces: lap
  table/controls, charts/maps/overlays, video player + overlays. Highest user
  value.
- **Phase 2 — Garage drawer.** `drawer` namespace (Files/Setups/Notes/Vehicles)
  — the single densest area; may sub-split across PRs.
- **Phase 3 — Tracks & device.** `tracks` + `device` namespaces (editor,
  submission, BLE/firmware).
- **Phase 4 — Plugins & cloud.** `plugins` namespace (cloud-sync panels, tools).
- **Phase 5 — Auth, legal, admin.** `pages` (auth) + `admin`. **Legal pages
  (Privacy/Terms) get a human/legal review per locale, never machine-only** — or
  stay English with a notice. Admin is gated + lowest priority.

After each phase, re-run `npm run i18n:seed` to fill the new namespaces.

---

## Testing

- **Pure, in coverage scope (`lib/`, scripts):** key-coverage parity across all
  locales (every `en` key exists everywhere, no extras), interpolation
  placeholder preservation, `format.ts` per-locale output, seed-script
  diff/validate/placeholder helpers.
- **Out of coverage (view layer, per `vitest.config.ts`):** the SettingsModal
  picker and `<Trans>` usages — exercised manually + by typecheck.
- **CI key integrity:** the generated `resources.d.ts` makes `tsc -b` fail on a
  missing/renamed key. A coverage test asserts locale parity so a half-seeded
  locale fails CI.

---

## Risks & edge cases

- **English flash on load** — mitigated by reading the language synchronously
  from localStorage before `createRoot` (§5/§6).
- **Layout breakage from longer strings** (German ~30% longer; Japanese
  line-breaking) — audit the densest UI (SettingsModal, drawer tabs) for fixed
  widths/truncation during each phase.
- **Pluralization beyond one/other** (e.g. future `ru`/`pl`/`ar`) — i18next CLDR
  rules cover it, but keys must use `count`, never hand-rolled `s` suffixes.
- **Machine-translation quality** — the `_machine`/`_reviewed` flags + glossary
  keep it honest; a discreet "auto-translated" UI hint sets expectations and the
  hand-tuning path never gets clobbered by re-seeding.
- **Canvas-rendered text** (charts/video overlays draw text on `<canvas>`, not
  DOM) — these strings still come from `t()` but won't benefit from
  `<Trans>`/DOM tooling; treat overlay labels as plain interpolated keys.
- **Service-worker cache staleness** — new/changed locale JSON ships with each
  deploy; the existing `autoUpdate` + 60s update poll + "Update ready" toast flow
  already handles cache refresh.
- **Bundle regression** — keep `i18next`/`react-i18next` in `vendor-i18n` and
  never static-import locale JSON into eager modules; the landing payload must
  stay lean (same discipline as `vendor-supabase`).

---

## Files touched (Phase 0)

**New:** `src/lib/i18n/{index,config,format,seedUtils}.ts` (+ `.test.ts`),
`src/lib/i18n/resources.d.ts` (generated), `public/locales/manifest.json`,
`public/locales/en/{common,pages,settings}.json` + seeded locale dirs,
`scripts/seed-translations.mjs`, `scripts/i18n-glossary.json`,
`docs/plans/i18n-translation-system.md` (this file).

**Edited:** `package.json` (deps + `i18n:seed` script), `vite.config.ts`
(`vendor-i18n` chunk + `includeAssets`), `src/main.tsx` (i18n init),
`src/App.tsx` (provider), `src/hooks/useSettings.ts` (`language` field),
`src/components/SettingsModal.tsx` (language picker), the migrated reference
surface (`LandingPage.tsx` + `SettingsModal.tsx`), `README.md` (Credits + env/
build notes), `src/components/CreditsDialog.tsx`, `CHANGELOG.md`, `CLAUDE.md`
(new i18n architecture section).

---

## Docs to update alongside the code (per CLAUDE.md)

- `CLAUDE.md` — add an "Internationalization" section (architecture map entry for
  `src/lib/i18n/`, `public/locales/`, the seeding script, the namespace scheme).
- `README.md` — Credits (i18next/react-i18next), the `npm run i18n:seed`
  workflow + its env var (LLM model/key, `???` for the secret), supported
  languages.
- `CreditsDialog.tsx` — mirror the README Credits additions.
- `CHANGELOG.md` — user-facing "added language support" entry under the current
  unreleased version, once strings actually flip (Phase 0+).
</content>
</invoke>
