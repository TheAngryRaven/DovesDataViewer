# Beta → Main Release Review — 2026-06-30

> Posted as a comment on PR #307. This is the local record copy.
> **Follow-up:** all six findings below were fixed on branch `fix/release-review-lows`
> (PR into BETA) — see the CHANGELOG `[3.0.0]` engine entry, `Leaderboards.tsx` /
> `ProfileAvatar.tsx` fixes, the new `publicProfile.test.ts` / `trackAutoSubmit.test.ts`,
> and the `0006 → 0007` branch-db plan rename.

## 🚦 Verdict: **GO**

Safe to ship. All seven dimensions ran; every confirmed finding is **Low** severity and **none block the release**. Blockers: **0 Critical, 0 release-blocking High**.

**PR:** #307 (`BETA` → `main`) · **Release:** v3.0.0 · **Since:** v2.9.2
**Run:** multi-agent (7 finders, single adversarial verify per finding — 6/6 confirmed, 0 dropped) · **Diff:** 145 files, ~7,000 insertions across 17 merged PRs
**Excluded:** `node_modules/`, `dist/`, generated `src/integrations/supabase/`, `bun.lock` line-noise

### Release contract checklist
| Gate | Status |
|------|--------|
| Coach on production npm (`@perchwerks/eye-in-the-sky@0.5.0`, both `package.json` + `vite.config.ts` + `bun.lock`) | ✅ |
| `package.json` version (`3.0.0`) == topmost CHANGELOG heading (`[3.0.0]`) | ✅ |
| CHANGELOG heading dated (`2026-06-30`, not `- unreleased`) | ✅ |
| CHANGELOG complete vs commits in this release | ⚠️ one user-facing change missing (REL-01, Low) → since fixed |
| No beta/preview-only config leaked into prod path (`main` → production creds; resolver gated to feature branches) | ✅ |
| CI green (ESLint / tsc -b / Vitest / coverage / build / CodeQL) | ✅ 11/11 |

> The coach pin is exact `0.5.0` rather than tilde `~0.5.0`. It is the published production package (not the BETA git dep), so the gate passes.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Low      | 6 |

Large but well-structured release (leaderboards plan 0005 + user profiles plan 0006 + branch-tiered Supabase backend + Alfano scaffolding + request-datalogger + full i18n). **Security, performance/bundle-budget, and merge/migration integrity all came back clean.** The six findings are polish.

## Findings (Low — by dimension)

### REL-01 — CHANGELOG omits the "engine now required on every vehicle" change
- `CHANGELOG.md:14` · Blocks release: no
- Commit 49b1566 makes engine a required field (guard + disabled submit + inline hint) in `VehiclesTab.tsx` and flags pre-existing engine-less vehicles; no mention under `## [3.0.0]` (Golden Rule 4).
- **Fix:** added a "Changed" bullet under `[3.0.0]`.

### COR-01 — Leaderboards top-session loading key can cross-disable buttons across courses
- `src/pages/Leaderboards.tsx:117` (disable check `:292`) · Blocks release: no
- `loadingKey` was `top:${group.key}`, but `group.key` is unique only within a course; the disclosure key already namespaces by `courseKey`.
- **Fix:** namespaced the loading key as `top:${course.courseKey}|${group.key}`.

### COR-02 — `ProfileAvatar` has no broken-image fallback
- `src/components/ProfileAvatar.tsx:28` · Blocks release: no
- `<img>` had no `onError`; a 404 rendered a broken-image glyph instead of the `UserIcon` placeholder.
- **Fix:** added a `failed` state + `onError` that degrades to the placeholder (resets on `url` change).

### TST-01 — `escapeLike()` ships without a test
- `src/plugins/cloud-sync/publicProfile.ts:32` · Blocks release: no
- Pure `ilike`-metacharacter escaper for the `/driver/:username` lookup, untested (Golden Rule 3).
- **Fix:** exported it + added `publicProfile.test.ts` (covers `_`, `%`, `\`, mixed, passthrough, empty).

### TST-02 — `autoSubmitSnapshotTrack()` skip/dedupe branches untested
- `src/plugins/cloud-sync/trackAutoSubmit.ts:15` · Blocks release: no
- Three branches gate the `submit-track` edge call; the pure core was tested but the orchestration wasn't.
- **Fix:** added `trackAutoSubmit.test.ts` mocking the dynamic imports + `functions.invoke` for every branch.

### DOC-01 — Plan-numbering collision: two plans both numbered 0006
- `docs/plans/0006-dynamic-supabase-branch-db.md:1` · Blocks release: no
- The branch-db plan reused 0006 instead of 0007 (Golden Rule 8).
- **Fix:** renamed to `0007-dynamic-supabase-branch-db.md` + updated its title and the "plan 0006" branch-db references in CLAUDE.md + README (user-profiles refs stay 0006).

## What was not covered

- Single adversarial verify per finding (default depth) — warranted given all findings are Low and verification was unanimous (6/6 survived).
- The 6-language locale diffs were treated as data (parity enforced by the green `i18n.test.ts`), not line-reviewed for translation quality.
- Migration runtime behavior was reasoned statically against the diff, not executed against live Postgres.
