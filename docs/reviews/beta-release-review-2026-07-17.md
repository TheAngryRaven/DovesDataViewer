# Beta → Main Release Review — 2026-07-17

## 🚦 Verdict: **GO-WITH-FIXES** → all confirmed findings fixed in PR #343 (now effectively **GO**)
No Critical and no release-blocking High. Four confirmed findings (2 Medium, 2 Low), all non-blocking; every one has been addressed on the release-prep branch. Blockers: **0**.

**PR:** #332 (`BETA` → `main`) · **Release:** v3.1.0 · **Since:** v2.9.2
**Run:** multi-agent (7 finders, single adversarial verify per finding) · **Diff:** 131 files, 25 commits
**Excluded:** node_modules, dist, generated supabase client, lockfile line-noise, vendored `public/sim/*` wasm blobs

### Release contract checklist
| Gate | Status |
|------|--------|
| Coach on production npm (`@perchwerks/eye-in-the-sky`, both package.json + vite.config.ts) | ✅ (already production on BETA; no flip needed) |
| `package.json` version == topmost CHANGELOG heading | ✅ (bumped 3.0.0 → 3.1.0 in PR #343) |
| CHANGELOG heading dated (not `- unreleased`) | ✅ (dated 2026-07-17 in PR #343) |
| CHANGELOG complete vs commits in this release | ✅ |
| No beta/preview-only config leaked into prod path | ✅ |
| CI green (lint / typecheck / test / build) | ✅ (2209 tests) |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 2 |
| Low      | 2 |

Two headline features drive this release — a public firmware simulator (`/simulator`) and shareable public session links (`/s/…`) — plus native firmware OTA and friendlier logger-download errors. The release contract is satisfied: coach is on the production npm package, version/changelog are set and dated (PR #343), and CI is green. The only confirmed issues were quality gaps on the new surfaces (a simulator backward-scrub perf/correctness pair on a non-core novelty page, one untested new anon-read module, and stale README). None block the release, and all four have been fixed on the release-prep branch. A notable **High was refuted**: the `shared_sessions` RLS is a deliberate public-read design (see "What was not covered").

## Findings (sorted: Critical → Low, then by dimension)

### [Medium] PERF-01 — Backward scrub re-boots the wasm sim and synchronously replays the whole session from start
- **Dimension:** performance · **Blocks release:** no
- **Location:** `src/hooks/useSimPlayback.ts:238-263`
- **Evidence:** `planScrub` returns `{reset:true, replayFromMs:sessionStartMs}` for any backward target, so `seek()` does `await sim.reset()` (re-instantiates the ~208 KB wasm) then a synchronous `injectPvt`+`stepMillis` loop over every sample from session start to target. The scrubber is wired via Radix `onValueChange` (fires continuously during a drag), so a near-end backward drag replays nearly the whole multi-minute session on the main thread.
- **Impact:** UI-thread jank/stutter (potentially seconds) on the public `/simulator` demo when dragging the timeline backward.
- **Recommendation:** Coalesce drag seeks to the latest target so only the settled value drives a reset+replay.
- **Effort:** M · **Confidence:** High
- **Status:** ✅ Fixed in PR #343 — `seek()` now coalesces via `pendingSeekRef`, collapsing an N-tick backward drag to at most two replays and rendering only the released position.

### [Medium] TEST-01 — New anon-read module `publicShare.ts` shipped with zero tests
- **Dimension:** testing · **Blocks release:** no
- **Location:** `src/plugins/cloud-sync/publicShare.ts:35-40`
- **Evidence:** New 89-line module powering the `/s/:token` viewer and the driver-profile "Shared sessions" list. It has testable pure logic — `embeddedDisplayName()` normalizes the Supabase profile embed across array/object shapes, and the fetch mappers null-guard date parsing — but no test referenced it (its write-side sibling `sessionShare.ts` has 16). Golden Rule 3.
- **Impact:** A silent regression (embed shape flips to array → driver name renders null; bad date) would ship undetected on a public, offline-first release.
- **Recommendation:** Add `publicShare.test.ts` covering both embed shapes, the null/absent-profile case, and the row→object mappings with present/null dates.
- **Effort:** S · **Confidence:** High
- **Status:** ✅ Fixed in PR #343 — added `publicShare.test.ts` (12 tests) covering both embed shapes, null profile, null dates, not-found, and error paths.

### [Low] COR-01 — Backward scrub drops the released slider value, snapping the thumb to a stale intermediate position
- **Dimension:** correctness · **Blocks release:** no
- **Location:** `src/hooks/useSimPlayback.ts:232-260`
- **Evidence:** `seek()` bailed immediately while `busyRef` was set and never queued the dropped request, so during a backward drag the first value locked the guard and every later value — including the final release value — was silently discarded; the controlled slider then snapped the thumb to the first intermediate target.
- **Impact:** Scrubbing backward on `/simulator` lands the cursor/thumb at a stale position (self-corrects on next interaction). Minor, novelty surface.
- **Recommendation:** Remember the latest requested target while busy and re-run to it once the in-flight seek clears.
- **Effort:** S · **Confidence:** Medium
- **Status:** ✅ Fixed in PR #343 — same `pendingSeekRef` coalescing fix as PERF-01.

### [Low] DOC-01 — README not updated for the new `/simulator` page and shareable session links
- **Dimension:** docs · **Blocks release:** no
- **Location:** `README.md:24-49`
- **Evidence:** Both features are documented in CHANGELOG, CLAUDE.md and docs/backend.md, but `README.md` is not in the 131-file diff — its Features list never mentions the simulator or session sharing. Golden Rule 5.
- **Impact:** The OSS front door omits two headline v3.1.0 features (a public page needing no account, and public link sharing).
- **Recommendation:** Add Features bullets for the firmware simulator and shareable session links.
- **Effort:** S · **Confidence:** High
- **Status:** ✅ Fixed in PR #343 — added README Features bullets for both.

## Must-fix before merge

**None.** No confirmed finding blocks the release, and all four have been fixed on the release-prep branch (PR #343 → BETA). Merge order still matters: land PR #343 into BETA before merging PR #332 (BETA → main).

## Themes & systemic notes

- The new **firmware simulator** (plan 0010) is well-isolated (pure `simPlayback` is Vitest-covered) but its React playback hook shipped with a scrub-coalescing gap on the public demo page — now fixed.
- New **cloud sharing** logic (plan 0009) was well tested on the write side; the anon **read** side (`publicShare.ts`) was the one untested unit — now covered.
- Docs were otherwise kept in sync (CLAUDE.md, docs/backend.md, docs/ble.md) — README was the lone straggler.

## What was not covered

- **SEC-01 (High) — refuted, not a finding.** A finder flagged the `shared_sessions` RLS `SELECT` policy (`using(true)`) as "fully enumerable by anon." The verifier refuted it on the merits: the same PR intentionally ships `fetchSharedSessionsByUser(userId)` — an anon `.eq("user_id", …)` query consumed by the public `DriverProfile` "Shared sessions" list — so public per-user enumeration is a deliberate, load-bearing feature mirroring the app's existing `leaderboard_entries` public-read pattern. The protected secret per the migration's own comments is the *filename*, and there is no filename column. Enumerable columns (track/course/date) plus the blob in the intentionally-`public` bucket are content the user explicitly published (and already surfaces on `/driver/:username`). No private data leaks. **Recommend a human sanity-check** of `supabase/migrations/20260715000000_shared_sessions.sql` given it's a new public surface, but it is not a release blocker.
- Two more refuted/pre-existing: CFG-01 (a landing "Build your own logger" tile rewired to a modal — the CHANGELOG covers it) and PERF-02 (the ~234 KB sim wasm added to the SW precache — intended, offline-first). Both verified as introduced-but-intended, not defects.
- Vendored `public/sim/*` wasm/mjs binaries were reviewed for wiring/intent only, not byte contents.
- Single adversarial verify per finding (default depth). No completeness-critic pass.
