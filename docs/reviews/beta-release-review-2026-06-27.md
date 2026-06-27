# Beta → Main Release Review — 2026-06-27

## 🚦 Verdict: **GO-WITH-FIXES**
No Critical or release-blocking High findings, and the coach plugin is correctly on the production npm package. The only true gate is unfinished release-prep (version is incoherent and the CHANGELOG is undated/incomplete); a Medium privacy gap in leaderboard submission is worth fixing before public exposure. **Blockers: 0 Critical, 0 release-blocking High.**

**PR:** #307 (`BETA` → `main`, *"Beta 3.0.0 - Leaderboards"*, draft) · **Release:** version TBD (see REL-02) · **Since:** v2.9.2
**Run:** multi-agent (7 finders, single adversarial verify) · **Diff:** 80 files, ~3.5k insertions, 8 PRs/commits since tag
**Excluded:** node_modules, dist, generated supabase client, lockfile line-noise, pre-existing main issues

> Note: PR **#304** is a Dependabot action bump (`cloudflare/wrangler-action` 3→4), **not** the release PR. The actual `BETA`→`main` release PR is **#307**, reviewed here.

### Release contract checklist
| Gate | Status |
|------|--------|
| Coach on production npm (`@perchwerks/eye-in-the-sky`, both package.json + vite.config.ts) | ✅ |
| `package.json` version == topmost CHANGELOG heading | ❌ (`2.9.2` vs `[2.10.0]`; PR title says `3.0.0`) |
| CHANGELOG heading dated (not `- unreleased`) | ❌ (still `- unreleased`) |
| CHANGELOG complete vs commits in this release | ❌ (missing required-engine change) |
| No beta/preview-only config leaked into prod path | ✅ |
| CI green (lint / typecheck / test / build / coverage) | ⏳ unknown (no checks reported on head `59156d8`) |

The three failing gates are exactly what the `beta-release-prep` skill exists to fix; this is a draft PR, so prep has not run yet. Run prep (or fix manually) before tagging.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 3 |
| Low      | 5 |

This release is structurally sound and safe to ship once release-prep is completed. The Leaderboards feature (plan 0005) is well-tested, the main→BETA merge was a clean no-op, setup-sharing was removed cleanly with no dead code/columns, and no IndexedDB migration was owed. The correctness sweep came back empty. The main residual risk is a **privacy gap** (SEC-1): the engine-telemetry "keep private" guarantee only scrubs 6 canonical channel ids, so telemetry recorded under non-canonical / `custom:` names can leak to the public, anon-readable table even with sharing off.

## Findings (sorted: severity → dimension)

### [Medium] REL-02 — Version incoherence across package.json, CHANGELOG, and PR title
- **Dimension:** release-config · **Blocks release:** yes (before tag)
- **Location:** `package.json` (`"version": "2.9.2"`), `CHANGELOG.md:14`
- **Evidence:** package.json is still `2.9.2` (= last tag), CHANGELOG top heading is `## [2.10.0] - unreleased`, PR #307 title says `Beta 3.0.0`. Three identities for one release. `vite.config.ts` bakes the in-app version stamp from package.json, so a build shipped now self-reports `2.9.2` while the changelog claims `2.10.0`.
- **Impact:** In-app version stamp, `versionCheck.ts` "update available" signal, changelog, and release title disagree.
- **Recommendation:** Run `beta-release-prep` (sets package.json to the topmost CHANGELOG heading and dates it), reconcile to one number, align the PR title.
- **Effort:** S · **Confidence:** High

### [Medium] REL-01 — CHANGELOG omits the "engine now required on every vehicle" change
- **Dimension:** release-config · **Blocks release:** no
- **Location:** `CHANGELOG.md:14-35`
- **Evidence:** Commit `49b1566` makes engine a required vehicle field (disabled submit + inline hint) and flags pre-existing engine-less vehicles with a warning (`src/components/drawer/VehiclesTab.tsx` + 8 locales). The `[2.10.0]` block has only `### Added` (Leaderboards); no `### Changed` entry for this behavioral change every existing user hits.
- **Impact:** Users upgrading face a new blocking validation with no release-note explanation; generated release notes will be incomplete (Golden Rule 4).
- **Recommendation:** Add a `### Changed` line under `[2.10.0]`, e.g. *"Vehicles now require an engine (powers leaderboard grouping / snapshot matching); existing engine-less vehicles are flagged."*
- **Effort:** S · **Confidence:** High

### [Medium] SEC-1 — Engine-telemetry privacy stripping uses a hardcoded canonical-id allowlist; custom-slug telemetry leaks even with sharing off
- **Dimension:** security · **Blocks release:** no
- **Location:** `src/lib/leaderboardTypes.ts:8-15`, `src/plugins/cloud-sync/leaderboardSubmission.ts:48-55`
- **Evidence:** `buildEntryData()` strips `extraFields` only when the key ∈ `ENGINE_TELEMETRY_CHANNELS` = `{rpm, water_temp, oil_temp, egt, temp_1, temp_2}`. Per `channels.ts`, channels normalize to a canonical id **or** a `custom:<slug>` key. Telemetry recorded under non-canonical names (EGT/CHT/Lambda/fuel-pressure or proprietary AiM/MoTeC columns) lands as `custom:` and survives into the uploaded `data.samples[].extraFields` + `fieldMappings`. Stripping is client-only; the RLS insert policy checks only `auth.uid() = user_id`, and approved rows are anon-readable.
- **Impact:** The consent UI promises only "GPS, engine name, lap time, weight" are public, but custom-named engine telemetry is published regardless — to an anonymously-readable table. Remedy is withdrawal of already-public data.
- **Recommendation:** Strip by channel **group** membership (include `custom:` slugs) or send an explicit GPS/speed allowlist only; ideally add a server-side trigger/CHECK rejecting non-whitelisted channel keys when `engine_telemetry_public = false`.
- **Effort:** M · **Confidence:** Medium

### [Low] SEC-2 — Submitter `display_name` is client-supplied and not validated server-side (spoofing / profanity-filter bypass)
- **Dimension:** security · **Blocks release:** no
- **Location:** `src/plugins/cloud-sync/LeaderboardSubmitPanel.tsx:99-107`, `supabase/migrations/20260626000000_leaderboards.sql:122-123`
- **Evidence:** `display_name` is read client-side from `getMyProfile()` and inserted directly; the RLS insert policy enforces only `auth.uid() = user_id` and never constrains it to `profiles.display_name`. The profile uniqueness + profanity filter (`profile.ts`) is bypassed by a direct/tampered insert.
- **Impact:** Public, anon-readable rows can carry spoofed or profane submitter labels until an admin denies them (allow-by-default).
- **Recommendation:** Denormalize `display_name` via a `BEFORE INSERT` trigger that derives it from `profiles` for `auth.uid()` instead of trusting the client.
- **Effort:** S · **Confidence:** High

### [Low] SEC-3 — `display_name` falls back to the user's email, written to an anon-readable public table
- **Dimension:** security · **Blocks release:** no
- **Location:** `src/plugins/cloud-sync/LeaderboardSubmitPanel.tsx:100`
- **Evidence:** `const displayName = profile?.display_name ?? user.email ?? "Anonymous";` — if `getMyProfile()` returns null (transient read failure), the email is inserted into the anon-readable `leaderboard_entries`.
- **Impact:** Latent PII (email) disclosure to the public leaderboard. Low likelihood (profiles auto-created at sign-up) but a real leak when hit.
- **Recommendation:** Drop the email fallback; abort the submit if the profile read genuinely fails. Combine with SEC-2 (source the name server-side).
- **Effort:** S · **Confidence:** High

### [Low] TEST-1 — `fnv1a.ts` shipped without a dedicated unit test
- **Dimension:** testing · **Blocks release:** no
- **Location:** `src/lib/fnv1a.ts:6-13`
- **Evidence:** New shared content-hash primitive (used by `trackSubmission.ts` + `leaderboardSubmission.contentHashForSnapshot`); no `fnv1a.test.ts`. Only transitively exercised; no known-vector / zero-padding / unsigned-wrap assertion.
- **Impact:** A regression (losing `padStart` or `>>>0`) would silently change every content hash and break both dedupe systems. Golden Rule 3.
- **Recommendation:** Add a tiny `fnv1a.test.ts` with a known-vector + 8-char zero-padded-length assertion.
- **Effort:** S · **Confidence:** High

### [Low] TEST-2 — `buildNewEntryRow` reverse-direction branch is untested
- **Dimension:** testing · **Blocks release:** no
- **Location:** `src/plugins/cloud-sync/leaderboardClient.ts:172`
- **Evidence:** `direction: isReverseCourseKey(snap.courseKey) ? "reverse" : null` — `leaderboardClient.test.ts` only uses a non-reverse courseKey and asserts only `lap_time_ms`; `direction` is never asserted for either branch.
- **Impact:** The reverse-direction mapping (feeds the read-only viewer's `selection.direction`) has no regression guard.
- **Recommendation:** Add one `it()` asserting `direction` for a normal and a `"...reverse"` courseKey.
- **Effort:** S · **Confidence:** High

### [Low] DOC-1 — `docs/backend.md` Leaderboards section omits the second (drop_setup) migration
- **Dimension:** docs · **Blocks release:** no
- **Location:** `docs/backend.md` (Leaderboards heading)
- **Evidence:** Heading/prose cite only `..._leaderboards.sql`; the feature ships two migrations (`...20260626..._leaderboards.sql` + `...20260627..._leaderboards_drop_setup.sql`). The plan doc records the drop amendment; backend.md does not.
- **Impact:** Cosmetic — the prose already describes the correct final state (no setup column).
- **Recommendation:** Add a one-line note that setup sharing was removed in the follow-up migration.
- **Effort:** S · **Confidence:** High

## Must-fix before merge

1. **REL-02** — Reconcile the version (package.json ↔ CHANGELOG heading ↔ PR title) and date the heading. This is release-prep; do it before tagging. *(Mechanically required, but it's the standard prep step, not a code defect.)*

Strongly recommended in the same pass (not hard blockers):
2. **REL-01** — Add the missing `### Changed` CHANGELOG entry for required-engine.
3. **SEC-1** — Close the engine-telemetry privacy gap before this table is publicly populated; leaked data can't be recalled.

## Themes & systemic notes

- **Release-prep hasn't run yet.** All three failing contract gates (version, dated heading, complete changelog) are the prep skill's job; the coach is already flipped to production npm, so prep may be partially staged.
- **Privacy is enforced client-side only.** SEC-1/2/3 share a root cause: the leaderboard trusts the client for what becomes public, anon-readable data, with no server-side compensating control. Worth a server-side guard pass on the submission path.
- **Feature quality is high.** Correctness came back clean; the merge is a verified no-op; setup-sharing removal left no dead code/columns; new pure modules are tested (the two test gaps are minor).

## What was not covered

- **CI status:** no checks were reported on head `59156d8` (status `pending`, 0 checks). The lint/typecheck/test/build/coverage gate is **unverified** — confirm green before merge.
- **Dropped finding (1):** a performance finding (PERF-1, "read-only handoff runs the full course-detection pipeline before injected laps overwrite it") was **refuted** during verification — its central mechanism was factually incorrect, so it was excluded.
- **Pre-existing main issues** were out of scope by design (release gate only weighs changes this PR introduces).
- Single adversarial verify per finding (default depth), not the 3-vote panel.
