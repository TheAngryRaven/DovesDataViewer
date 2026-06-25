# Beta → Main Release Review — 2026-06-25

## 🚦 Verdict: **GO-WITH-FIXES**
No Critical and no High findings. The code is shippable; the only blockers are
release-labeling steps — `package.json` is still `2.9.1` and the CHANGELOG has two
stacked `- unreleased` headings. Blockers: 0 Critical, 0 release-blocking High; 2
Medium release-cut fixes to apply before tagging.

**PR:** #287 (`BETA` → `main`) · **Release:** v2.9.2 · **Since:** v2.9.0 (no tags in repo; scope = `main…BETA`)
**Run:** multi-agent (7 finders, single adversarial verify) · **Diff:** 129 files, 46 commits, +4760/−772
**Excluded:** node_modules, dist, generated supabase client, lockfile line-noise

### Release contract checklist
| Gate | Status |
|------|--------|
| Coach on production npm (`@perchwerks/eye-in-the-sky` in package.json + vite.config.ts + bun.lock) | ✅ |
| `package.json` version == topmost CHANGELOG heading | ❌ (pkg `2.9.1` vs CHANGELOG `[2.9.2]`) |
| CHANGELOG top heading dated (not `- unreleased`) | ❌ (date on cut — PR is still a draft) |
| CHANGELOG complete vs commits in this release | ✅ (no missing user-facing entries found) |
| No beta/preview-only config leaked into prod path | ✅ |
| CI green (lint / typecheck / test / build / coverage) | ✅ (all 11 checks green) |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 2 |
| Low      | 2 |

The signature gate passes cleanly: the eye-in-the-sky coach is on the **production**
npm package `@perchwerks/eye-in-the-sky@0.5.0` in all three places (package.json,
`vite.config.ts` `DEFAULT_PLUGIN_PACKAGES`, and `bun.lock`) — no BETA git dependency
leaking through, which is the canonical NO-GO this gate exists to catch. The Lovable
defaults were removed cleanly (blank Supabase fallbacks, `lovable-tagger`/
`@lovable.dev/cloud-auth-js` dropped), no preview creds or debug flags leak into the
prod path, the new `videoStorage` fields are additive-optional (no `DB_VERSION` bump
needed), and the substantial new logic (`videoTimeline`, `referenceUtils`,
`submissionMaterialize`, the native doveslogger/IPC adapters) ships with Vitest
coverage. The only real risk is cosmetic version labeling: the build would stamp
`2.9.1` while shipping `2.9.2` changes. Fix the version + changelog headings at the
cut and this is a clean GO.

## Findings (sorted: Critical → Low, then by dimension)

### [Medium] REL-01 — package.json version not bumped to 2.9.2 (build will stamp 2.9.1)
- **Dimension:** release-config · **Blocks release:** yes (must fix at cut)
- **Location:** `package.json:4`
- **Evidence:** On `origin/BETA`, `package.json` still reads `"version": "2.9.1"`
  (identical to `main`), yet CHANGELOG adds `## [2.9.2] - unreleased` and the PR is
  titled "Beta 2.9.2". `vite.config.ts` derives `appVersion` from `pkg.version` and
  bakes it into `VITE_APP_VERSION` and the emitted `/version.json`. Prior cycles bumped
  the version inside an ordinary commit (e.g. `7dd2658` bumped 2.9.0→2.9.1), so the
  bump is normally advanced during the cycle, not deferred — this one was simply missed.
- **Impact:** The footer "what changed" stamp and `version.json` would report `2.9.1`
  while the app contains 2.9.2 changes; a clean 2.9.2 tag can't be cut until pkg is advanced.
- **Recommendation:** Bump `package.json` `"version"` to `2.9.2` before merge.
- **Effort:** S · **Confidence:** High

### [Medium] REL-02 — CHANGELOG carries two stacked `- unreleased` versions
- **Dimension:** release-config · **Blocks release:** no (release hygiene)
- **Location:** `CHANGELOG.md:14` (and `:132`)
- **Evidence:** `## [2.9.2] - unreleased` (line 14) sits directly above
  `## [2.9.1] - unreleased` (line 132) — both undated, with the dated `## [2.9.0] -
  2026-06-22` below. Golden Rule 4 says date/tag a version before opening the next
  block. The undated 2.9.1 is pre-existing on `main`; the **stacking** is new to this PR.
- **Impact:** Ambiguous release history — two versions' worth of changes sit under two
  undated headings, so a reader/automation can't tell which version a build is.
- **Recommendation:** Pick the single release version, fold or date the leftover 2.9.1
  block, and date `[2.9.2]` on the cut so exactly one (or zero, dated) `unreleased`
  heading remains.
- **Effort:** S · **Confidence:** High

### [Low] COR-01 — Scrub-coalescing rAF clamps against a stale `visibleRange`
- **Dimension:** correctness · **Blocks release:** no
- **Location:** `src/hooks/useLapManagement.ts` (new `scrubRafRef`/`handleScrub` rAF hunk, ~L131–155)
- **Evidence:** `handleScrub` now defers the clamp into a `requestAnimationFrame`
  callback that closes over `visibleRange` from the scheduling render:
  `Math.min(idx, visibleRange[1] - visibleRange[0])`. If `visibleRange` changes
  (crop/sector-select/resize) in the same frame a scrub is pending, the in-flight
  callback clamps against the old window. New on BETA — `main`'s `handleScrub` clamps
  synchronously.
- **Impact:** At most a single-frame off cursor clamp right after a range change while
  dragging; self-corrects on the next scrub event. No data loss or crash.
- **Recommendation:** Read the latest range from a `visibleRangeRef` inside the rAF, or
  let the existing currentIndex-correcting effect re-clamp.
- **Effort:** S · **Confidence:** High

### [Low] DOC-02 — Orphaned `continueWithGoogle` translation keys left in all 8 locales
- **Dimension:** docs · **Blocks release:** no
- **Location:** `src/locales/en/auth.json:7` + `src/locales/en/plugins.json:12` (and the
  same keys in `es/fr/de/it/pt-BR/ja`)
- **Evidence:** This PR removes all Google sign-in UI and its only consumers (the
  `enableGoogleAuth` gates + `t('continueWithGoogle')` calls in `Login.tsx`,
  `Register.tsx`, `cloud-sync/StoragePanel.tsx`). `git grep continueWithGoogle` over
  BETA's non-locale source returns zero hits, but the translation keys remain in every
  locale. (CLAUDE.md's env table correctly dropped `VITE_ENABLE_GOOGLE_AUTH` — only the
  locale keys lag.)
- **Impact:** Dead i18n entries across 8 languages with no code path (Golden Rule 7).
  Harmless at runtime; stale.
- **Recommendation:** Delete the key from `en/auth.json` + `en/plugins.json` (source of
  truth) and re-run the seeder / drop it from the other 7 locales.
- **Effort:** S · **Confidence:** High

## Must-fix before merge

1. **REL-01** — bump `package.json` `version` to `2.9.2`.
2. **REL-02** — collapse the two stacked `- unreleased` headings into the single release
   version and date `[2.9.2]` when you cut/tag.

Both are the normal release-finalization steps (the PR is still a draft). COR-01 and
DOC-02 are Low and can ride a follow-up.

## Themes & systemic notes

- **Release plumbing is the only soft spot.** Every functional dimension (security,
  bundle budget, migrations, testing, the large video-sync/split-graphs rework) came
  back clean after adversarial verification. The misses are bookkeeping: the version
  field and changelog headings trailing the actual content.
- **Clean removals.** The Lovable de-coupling and Google-OAuth removal were thorough on
  the code/doc side; only the orphaned locale strings (DOC-02) lag — a recurring pattern
  worth a "drop the keys too" step when removing a localized surface.
- **Coach gate is correct** — no action needed; called out only because it's the headline
  thing this review exists to verify.

## What was not covered

- Single adversarial verify per finding (default depth), not the 3-vote panel — adequate
  for a diff this clean, but a "thorough" re-run could split the security/correctness
  dimensions further.
- Pre-existing issues already on `main` (e.g. the undated `2.9.1` heading in isolation,
  the exact-pin vs tilde-pin of the coach dep) were excluded from the verdict by design —
  only what this PR introduces or leaves unfinished gates the release.
- The adversarial pass **dropped** 4 finder candidates as pre-existing or
  already-handled (3 duplicate framings of the version/changelog issue captured by
  REL-01/02, and one "heading still unreleased" call that's correct per Golden Rule 4
  for an in-flight draft). No confirmed finding was dropped for lack of verification.
