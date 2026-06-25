# Codebase Review — 2026-06-25

**Project:** Dove's DataViewer / LapWing (FOSS, GPLv3, offline-first PWA)
**Scope:** `main` @ `d0dd71e` (working tree == origin/main) · **Run:** multi-agent (7 dimension finders, single adversarial verify per finding)
**Excluded:** node_modules, dist, generated `src/integrations/supabase/`, lockfiles, vendored assets

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 1 |
| Medium   | 7 |
| Low      | 8 |

The codebase is in genuinely good professional shape — no critical defects, no data-loss
bugs, no secrets, and the documented architecture (single-source modules, parser contract,
context split) is largely honored. The one **High** is an edge-function security gap: three
abuse-protection endpoints trust a client-spoofable `x-forwarded-for` header, so rate limits,
IP bans, and the login brute-force lockout are bypassable. The systemic weaknesses are
**duplication of load-bearing logic** (the unit literal, the parser-detection ladder) and
**tests trailing data-sensitive logic** (Alfano date, cloud-sync orchestration, parser reject
branches) — both invariant-eroding rather than actively broken today.

## Findings (sorted: Critical → Low, then by dimension)

### [High] SEC-1 — IP rate-limiting and IP bans trust client-spoofable `x-forwarded-for`
- **Dimension:** security
- **Location:** `supabase/functions/submit-track/index.ts:149-150`, `submit-message/index.ts:49-50`, `check-login-rate/index.ts:27-28`
- **Evidence:** All three public, abuse-protected edge functions derive the caller IP as `x-forwarded-for?.split(',')[0]?.trim() || cf-connecting-ip || 'unknown'` — the client-supplied leftmost XFF hop takes precedence over the platform header. These functions are the **only** enforcement path (the `submissions`/`messages`/`login_attempts` tables are RLS-deny-all to clients). `check-login-rate:26` even comments "never trust a client-provided IP," which the code contradicts.
- **Impact:** Rotating a forged `X-Forwarded-For` bypasses per-IP rate limits (300 rows/hr, 3 msgs/hr), evades admin IP bans, and defeats the login lockout (credential brute-force). The login limiter additionally fails open on error and on `unknown`.
- **Recommendation:** Read the platform-trusted header first; only fall back to the **last** (rightmost, infra-set) XFF hop. Never take `split(',')[0]`. Centralize in one shared helper across all three functions. Note: these run on Supabase/Deno Deploy, so verify which header the infra actually sets (the truly trusted value is the rightmost hop, not `cf-connecting-ip`).
- **Effort:** S · **Confidence:** Medium

### [Medium] ARCH-001 — Speed conversion `1.60934` duplicated inline, bypassing `lib/units.ts`
- **Dimension:** architecture
- **Location:** `src/components/graphview/InfoBox.tsx:80`, `RaceLineView.tsx:86,532`, `graphview/MiniMap.tsx:28`
- **Evidence:** Four view sites hardcode the MPH→KPH literal and define a local `convertSpeed`/inline math, plus re-hardcode the `'kph'/'mph'` label. `lib/units.ts:22` exports the canonical `KPH_PER_MPH = 1.60934` and `speedUnitLabel()` (line 31) but no `convertSpeed` helper, so callers re-derive the magic constant. `convertSpeed` exists *only* as these inline duplicates.
- **Impact:** Violates the documented single-source rule ("All conversions live in `lib/units.ts` … convert only at display time"). The four copies are untested and drift independently — a units/rounding fix won't reach the map/minimap/infobox readouts.
- **Recommendation:** Add `convertSpeed(mph, useKph)` to `lib/units.ts`, reuse `speedUnitLabel`, replace the four inline conversions. No behavior change.
- **Effort:** S · **Confidence:** High

### [Medium] ARCH-002 — `datalogParser` format-detection ladder is triplicated across three routing functions
- **Dimension:** architecture
- **Location:** `src/lib/datalogParser.ts:62-131` (routeDatalogFile), `133-185` (routeDatalogContent ArrayBuffer branch), `187-217` (string branch)
- **Evidence:** The ordered detector chain (Motec LD → UBX → iRacing → VBO → MoTeC CSV → Dovex → Dove → AiM-sig → Alfano → AiM → NMEA) is written out three times. The text ladder is an exact triplicate; the binary chain appears twice. CLAUDE.md flags this ordering as load-bearing ("Detection order matters").
- **Impact:** CLAUDE.md's "add a parser" recipe says register in "both" functions, but the real surface is three ladders — it understates the drift risk. A parser added to two of three, or inserted at the wrong precedence in one, silently mis-detects on one entry path (import vs BLE/sample-sync).
- **Recommendation:** Extract one ordered detector table (`{ detectBuffer?, detectText?, parse }[]`) iterated by all three entry points; keep the async XRK case and the sync "refuse XRK" guard as thin wrappers.
- **Effort:** M · **Confidence:** High

### [Medium] C1 — Alfano parser never reads session date; `startDate` always undefined
- **Dimension:** correctness
- **Location:** `src/lib/alfanoParser.ts:239,429`
- **Evidence:** `startDate` is declared (239) and returned (429) but never assigned anywhere in `parseAlfanoFile`. The format keys detection off a `Date:` metadata row (`/^date\s*:/i`) and skips those rows during parsing without ever extracting them. Other parsers (dove/ubx/nmea/aim) all populate `startDate`.
- **Impact:** Every Alfano session loses its real recording date. Historical-weather lookup (keyed on session date) and session naming fall back to first-sample/relative time — wrong weather and labels for all Alfano imports. Degrades gracefully, not a crash.
- **Recommendation:** Parse the `Date:`/`Time:` preamble rows into a `Date` (mirror `parseAimStartDate`), assign to `startDate`, add a regression test asserting non-undefined `startDate`.
- **Effort:** S · **Confidence:** High

### [Medium] C2 — GPS-derived lateral G is silently zero for parsers with no heading fallback
- **Dimension:** correctness
- **Location:** `src/lib/gforceCalculation.ts:75-91`
- **Evidence:** `calculateAccelerations` only computes lateral G when both neighbor headings are defined; otherwise latG stays 0. The dove and NMEA parsers populate a GPS-bearing heading fallback when no heading column exists, but `aimParser`, `vboParser`, `motecParser`, and `iracingParser` (no heading at all) do not. iRacing even registers `Lat G` as an enabled mapping, guaranteeing a flat-zero primary on every import lacking heading.
- **Impact:** For AiM/VBO/MoTeC/iRacing files missing a heading column, the always-shown primary Lat G channel — charted, used in the G-G diagram and braking analysis — is uniformly 0 ("the car never corners"). Misleading telemetry shown as real derived data. (iRacing still has accurate `Lat G (Native)` from LatAccel.)
- **Recommendation:** Factor dove's `calculateBearing` GPS-fallback into `parserUtils` and apply it in aim/vbo/motec/iracing before G-force derivation — or skip emitting the primary Lat G when no heading source exists. Add a test asserting non-zero lateral G on a curved path with no heading column.
- **Effort:** M · **Confidence:** Medium

### [Medium] TEST-001 — Cloud-sync auto-sync orchestration (debounce/flush/reconcile) is entirely untested
- **Dimension:** testing
- **Location:** `src/plugins/cloud-sync/autoSync.ts:77-192`
- **Evidence:** 192 lines, no `autoSync.test.ts`. Owns offline-first sync orchestration: `schedule()` debounces per-key changes, `flush()` routes failures three ways (offline→markPending, quota→notify, network→re-pend), `runReconcile()` reconciles docs and snapshots independently. The 18 cloud-sync test files cover the primitives (merge/syncEngine/fileSync) but none drives this scheduler/reconcile.
- **Impact:** Exactly the data-loss-sensitive "protocol logic" Golden Rule 3 mandates testing. A regression in coalescing, the markPending retry path, or independent doc/snapshot reconcile could silently drop pending garage changes with no failing test.
- **Recommendation:** Add `autoSync.test.ts` with fake timers: assert `schedule()` coalesces rapid same-key changes into one flush, `flush()` calls `markPending` (not `pushOne`) when offline and re-pends on network error but notifies on quota, and `runReconcile()` still reconciles snapshots when `reconcileDocs` throws (and vice versa).
- **Effort:** M · **Confidence:** High

### [Medium] cicd-2 — No Bun version pinned in any workflow despite a reproducibility-first policy
- **Dimension:** ci
- **Location:** `.github/workflows/lint.yml:18` (and typecheck:22, test:18, build:18, coverage:26)
- **Evidence:** Every workflow uses `uses: oven-sh/setup-bun@v2` with no `with: bun-version:` and no `.bun-version`/`packageManager` fallback, so setup-bun installs the latest Bun at run time. CLAUDE.md mandates `--frozen-lockfile` for reproducibility, and `deploy-beta-proxy.yml:29-32` deliberately pins `WRANGLER_VERSION` "so runs are reproducible" — the same reasoning isn't applied to Bun.
- **Impact:** A new Bun release can change lockfile resolution, transpilation, or test runtime and turn CI red (or mask a regression) on an unrelated PR. The toolchain is the one floating dependency in an otherwise frozen pipeline.
- **Recommendation:** Pin `with: bun-version: <x.y.z>` (or a `.bun-version` file) across all five workflows, matching local + Cloudflare, and bump deliberately.
- **Effort:** S · **Confidence:** High

### [Medium] CQ-1 — `CreditsDialog.tsx` and README Credits disagree (Golden Rule 5)
- **Dimension:** quality
- **Location:** `src/components/CreditsDialog.tsx:9-39`
- **Evidence:** Golden Rule 5 requires "README Credits and CreditsDialog must agree." README credits CARTO basemaps, Esri World Imagery & Wayback, and Supabase — none in the dialog's `CREDITS` array. The dialog lists OpenStreetMap, absent from README Credits. `@supabase/supabase-js` is a runtime dep but uncredited in-app.
- **Impact:** User-facing in-app Credits omits FOSS/service attributions the README acknowledges, violating a documented Golden Rule and the project's attribution intent. Drift widens as deps change.
- **Recommendation:** Reconcile the two lists — add Supabase, CARTO, Esri Wayback to `CreditsDialog.tsx` (or drop from README if intentional) and align OpenStreetMap vs CARTO/Esri naming so both match exactly.
- **Effort:** S · **Confidence:** High

### [Low] SEC-2 — Checkout/portal sessions accept an unvalidated client `returnUrl` (open redirect)
- **Dimension:** security
- **Location:** `supabase/functions/create-checkout-session/index.ts:122,130-131`; `create-portal-session/index.ts:59,69`
- **Evidence:** Both functions take `returnUrl` straight from request JSON (only a `typeof === 'string'` check) and build Stripe `success_url`/`cancel_url`/`return_url` from it, with no origin allowlist. An attacker with a valid JWT can call directly with an arbitrary host.
- **Impact:** Authenticated user tricked into a crafted link can be redirected to an attacker origin after the Stripe flow (open redirect). Limited blast radius — self-redirect only, no token forwarded — so polish-level hardening.
- **Recommendation:** Validate `returnUrl` against an allowlist of known app origins, or ignore it and always use the verified request `origin`/configured base. Reject/fall back on host mismatch.
- **Effort:** S · **Confidence:** High

### [Low] C3 — MoTeC CSV parser assumes a units row always follows the header, dropping a data row when absent
- **Dimension:** correctness
- **Location:** `src/lib/motecParser.ts:76-80`
- **Evidence:** After finding the channel-names row (`key === 'time'`), it unconditionally treats the next line as units (`unitsIdx = headerEndIdx + 1`, `dataStartIdx = unitsIdx + 1`) with no check that the line is actually units vs the first data row; `units[speedCol]` then drives speed-unit detection.
- **Impact:** A MoTeC-style CSV without a units row consumes its first real sample as "units" (silently dropped) and speed detection reads a number, defaulting to km/h (potential mis-scaling). Real i2 Pro always emits units, so this only bites third-party/malformed exports.
- **Recommendation:** Validate the `unitsIdx` line is non-numeric before consuming it; if numeric, set `dataStartIdx = unitsIdx` and skip unit-based speed detection. Add a no-units fixture.
- **Effort:** S · **Confidence:** Medium

### [Low] C4 — `normalizeChannels` duplicate-key fallback doesn't re-check the custom key for collision
- **Dimension:** correctness
- **Location:** `src/lib/channels.ts:186-189`
- **Evidence:** When two columns resolve to the same key, the loser is reassigned `key = customChannelId(m.name)` and added to `usedKeys`, but the custom key is never tested against `usedKeys` before insertion. Two raw names that slug identically (e.g. "Brake P" / "Brake-P" → `custom:brake_p`) collapse to one key, and one column's samples clobber the other in the extraFields rename.
- **Impact:** Rare, but two distinct logger columns can silently merge into one channel, losing a series — undermining the documented "two source columns must never collapse onto one channel id" invariant.
- **Recommendation:** Loop/suffix the custom key (`_2`, `_3`…) until it's not in `usedKeys` before assigning. Add a test with three slug-colliding columns.
- **Effort:** S · **Confidence:** Medium

### [Low] TEST-003 — iRacing `.ibt` speedCap/teleportation rejection branches have no assertions
- **Dimension:** testing
- **Location:** `src/lib/iracingParser.ts:235-246`
- **Evidence:** The parser increments `rejected.speedCap` and `rejected.teleportation` for the binary path, but `iracingParser.test.ts` never asserts `parserStats.rejected` for either (no `speedCap`/`teleportation`/`rejected` references). `doveParser.test.ts` asserts its reject stats explicitly. The shared `isTeleportation` helper *is* unit-tested in `parserUtils.test.ts`, limiting severity.
- **Impact:** A regression dropping the `continue` (admitting a teleport/over-cap sample) or mis-counting the stat would pass CI for the iRacing path.
- **Recommendation:** Add an iRacing fixture exceeding `MAX_SPEED_MPS` and one with an implausible lat/lon jump; assert exclusion and stat increments.
- **Effort:** S · **Confidence:** High

### [Low] TEST-004 — `overlayCanvasRenderer` pure layout/text-metric helpers aren't isolated for testing
- **Dimension:** testing
- **Location:** `src/lib/overlayCanvasRenderer.ts:25-49`
- **Evidence:** 677 lines, no test file. `computeLayout()` is pure geometry but module-private, reachable only through `renderOverlaysToCanvas()` (needs a `CanvasRenderingContext2D`). Sibling video-overlay logic (dataSourceResolver/overlayUtils/sectorUtils/themes) is each tested; the renderer's layout math is the one untested pure piece in the export path.
- **Impact:** Overlay positioning math (in exported MP4 frames) can drift without a regression test; the gap is partly a factoring issue since the fn is private.
- **Recommendation:** Extract `computeLayout` (and the text-width estimate at line 100) into an exported pure helper, add a focused layout test across anchor/size inputs — mirroring how `shouldStreamExport` was extracted to `videoExportTarget.ts` and tested.
- **Effort:** S · **Confidence:** Medium

### [Low] cicd-1 — Coverage workflow comment claims a 1% threshold; real floors are 45-50%
- **Dimension:** ci
- **Location:** `.github/workflows/coverage.yml:30-31`
- **Evidence:** Comment says the job fails "below the threshold set in vitest.config.ts (currently 1%)", but `vitest.config.ts:42-47` sets `{ lines: 50, functions: 45, branches: 45, statements: 49 }`. Stale by ~50x. Enforcement is unaffected (read at runtime from config).
- **Impact:** Misleading CI doc-drift (Golden Rule 5) — a maintainer may think the gate is off, or lower the real thresholds thinking they're decorative.
- **Recommendation:** Update the comment to the actual floors, or just say "see `vitest.config.ts` thresholds" without quoting a number.
- **Effort:** S · **Confidence:** High

### [Low] cicd-3 — Production deploy (Cloudflare Workers Builds) isn't gated by the GitHub Actions CI checks
- **Dimension:** ci
- **Location:** `wrangler.jsonc:3-6`
- **Evidence:** The main app deploys via Cloudflare Workers Builds, which runs only `bun run build` (`vite build`) + `wrangler deploy` — never lint/typecheck/test. The five GitHub Actions workflows run separately; nothing in-repo makes the Cloudflare deploy wait on them.
- **Impact:** Golden Rule 6 ("Green before merge") depends entirely on GitHub branch protection requiring those checks. If a check isn't marked required, a push to main with red typecheck/test still triggers a production deploy (Vite build can pass while the app is logically broken). For a public OSS main, branch protection is very likely set, hence Low.
- **Recommendation:** Confirm and document in-repo that the five checks are required on `main`, or fold `tsc -b` + `test:run` into the Cloudflare `build.command` so the deploy path shares the CI gate.
- **Effort:** M · **Confidence:** Medium

### [Low] CQ-2 — Leftover plain `console.log` debug statements (Golden Rule 7)
- **Dimension:** quality
- **Location:** `src/components/VideoPlayer.tsx:533`; `src/lib/videoExport.ts:253`
- **Evidence:** `VideoPlayer.tsx:533` emits `console.log("Video saved to app storage")` in the export-success path (its catch correctly uses `console.error`); `videoExport.ts:253` emits `console.log("AudioEncoder not available, skipping audio")`. These are the only two non-gated, non-error `console.log` calls in `src/` (the third, `ble/internal.ts:16`, is gated behind `BLE_DEBUG`).
- **Impact:** Production console noise; minor convention violation on released OSS, explicitly called out by Golden Rule 7.
- **Recommendation:** Delete `VideoPlayer.tsx:533`; remove or promote `videoExport.ts:253` to `console.warn` if worth surfacing.
- **Effort:** S · **Confidence:** High

## Themes & systemic issues

- **Duplication of load-bearing logic.** The two architecture findings are the same shape:
  a single-source-of-truth that the code routes *around* — the `1.60934` literal copied into
  four views instead of `units.ts` (ARCH-001), and the parser-detection precedence written out
  three times instead of one table (ARCH-002). Both are drift hazards on exactly the logic
  CLAUDE.md flags as authoritative. Consolidating each removes a whole class of future bugs.
- **Tests trail data-sensitive logic.** Three of four testing/correctness findings are
  "this branch works but nothing proves it stays working": cloud-sync orchestration (TEST-001),
  parser reject branches (TEST-003), overlay layout math (TEST-004), plus the Alfano date that a
  test would have caught (C1). Golden Rule 3 is mostly honored — these are the visible gaps at
  the edges (orchestration wiring, binary-path reject counters, private pure helpers).
- **Edge-function input trust.** Both security findings are server-side trust of client input —
  the spoofable IP (SEC-1, the real one) and the unvalidated `returnUrl` (SEC-2). The offline-first
  client surface is clean; the small server surface is where to concentrate hardening. A shared
  "trusted IP" helper and an origin allowlist close both.
- **Reproducibility/doc-drift in CI.** The pipeline is otherwise disciplined (frozen lockfile,
  enforced floors), with two small gaps: an unpinned Bun (cicd-2) and a stale threshold comment
  (cicd-1), plus the deploy-gate question (cicd-3).

## What was not covered

- **Performance** returned **zero** findings — the finder swept render hot paths (per-tick
  playback, Canvas charts, Leaflet), parser throughput, leaks (listeners/workers/object URLs),
  and the SessionContext/PlaybackContext split, and found nothing meeting the bar. Genuinely
  clean, not skipped.
- **Single adversarial verify per finding** (default depth). Of the finders' raw output, only
  findings that survived one refutation pass are listed; borderline/unverifiable findings were
  dropped at the cited-location check, so this backlog is conservative. A "thorough" re-run
  (3-vote perspective-diverse verify + completeness critic) could surface more Low/Medium items.
- **Not audited:** the generated `src/integrations/supabase/` client (excluded by contract),
  `bun.lock` contents, and external plugin packages not in-repo (the coach is gitignored on
  `main`). GitHub **branch-protection settings** (central to cicd-3) are server-side config not
  visible in the repo and were not verified.
