---
name: beta-release-review
description: >-
  Deep, multi-agent release-gate review of a BETA → main pull request (the release
  PR), posted as a report comment on the PR. Use when the user asks to "review the
  beta to main PR", "review the release PR", "is beta ready to merge into main",
  "release review", or "gate the release". Reviews the PR DIFF (everything on BETA
  since it diverged from main), runs fixed dimensions with adversarial verification,
  and produces a severity-sorted report plus an explicit GO / GO-WITH-FIXES / NO-GO
  verdict — then posts it as a PR comment. For a whole-codebase audit use
  `codebase-review`; for an arbitrary working diff use the built-in `code-review`.
---

# Beta → Main Release Review — release-gate audit of the release PR

A repeatable, opinionated, multi-agent review of a **single BETA → main PR**: the
batch of changes that make up a release. Unlike `codebase-review` (whole tree) or
`code-review` (arbitrary working diff), this one is a **release gate** — it scopes
to the PR diff, weighs everything against "is this safe to ship to production
users today," and ends with a clear **GO / GO-WITH-FIXES / NO-GO** verdict that is
posted back as a comment on the PR.

The headline thing this gate exists to catch — the same one `beta-release-prep`
fixes — is that **the eye-in-the-sky coach plugin must be on the published
production npm package, not the BETA git dependency, before BETA merges to main.**
A release that ships the BETA coach source is the canonical NO-GO.

## Context this project assumes

- **FOSS, GPLv3, publicly released (v1.5.0+), offline-first PWA.** Judge at
  professional OSS standards. Golden Rule 1: never do on the server what the client
  can do; server surfaces (Supabase edge functions, cloud sync, admin) carry the
  real security risk.
- The durable conventions live in `CLAUDE.md` and `docs/`. **A violation of a
  stated Golden Rule or convention is a finding.** Read `CLAUDE.md` first — its
  "⚠️ coach source differs by branch" and bundle-splitting blocks are directly
  load-bearing here.
- Toolchain is **Bun + Vite + React 18 + TS + Vitest**; CI is five workflows
  (`lint`, `typecheck`, `test`, `build`, `coverage`).
- Releases are tagged manually on `main` after merge; the latest tag is the last
  shipped version. This review covers everything between that tag and BETA.

## How to run it

This is an explicit opt-in to multi-agent orchestration: **run it as a `Workflow`.**
The workflow is what makes the result repeatable — fixed dimensions, adversarial
verification, deterministic synthesis. Do not freelance a single-agent sweep.

### 1. Identify the PR and gather the diff (inline, cheap)

- Find the open release PR: base `main`, head `BETA`
  (`list_pull_requests(owner, repo, base="main", head="BETA", state="open")`).
  Owner/repo: `TheAngryRaven/DovesDataViewer`. If the user passed a PR number, use
  it. If none is open, tell the user and stop — there's nothing to gate.
- Establish the review scope locally:
  ```bash
  git fetch --all --tags --prune
  LAST_TAG=$(git tag --sort=-v:refname | head -1)
  git diff origin/main...origin/BETA --stat        # the PR diff (merge-base → BETA)
  git log "$LAST_TAG"..origin/BETA --oneline        # commits in this release
  git log "$LAST_TAG"..origin/BETA --oneline --merges   # merged PRs (cleanest summary)
  ```
  Use `origin/main...origin/BETA` (three-dot) — changes on BETA since it diverged,
  which is exactly what the PR will merge. Capture the per-file diff for the finders;
  for large diffs, give each finder the relevant file list rather than one giant blob.
- **Exclude from findings:** `node_modules/`, `dist/`, `bun.lock` (review its
  *intent*, not line-by-line), `src/integrations/supabase/` (generated), vendored
  assets. `bun.lock` churn from the coach flip is expected, not a finding.

### 2. Fan out one agent per dimension (the seven below)

Each agent is a harsh, skeptical release reviewer for ITS dimension only, scoped to
**this PR's diff**, returns **structured findings**, and must cite `file:line`. An
agent that finds nothing returns an empty list — do not pad. Give every finder the
commit list + changelog section so it can judge completeness, not just the raw diff.

### 3. Adversarially verify every finding

A separate agent tries to **refute** each finding ("is this actually true at this
line in the diff? is it already handled? is it intended per CLAUDE.md? is it
pre-existing on main and not introduced by this release?"). Drop findings that don't
survive. Pre-existing issues already on `main` are **out of scope** for a release
gate — note them separately at most; only changes this PR introduces or fails to
finish block the release.

### 4. Synthesize → report + verdict

Dedupe across dimensions, sort by severity then dimension, and compute the
**release verdict** (see rubric). Write the report using `report-template.md`.

### 5. Post the report as a PR comment

This is the deliverable. Post the report as a comment on the release PR via the
available mechanism — `mcp__github__add_issue_comment(owner, repo, issue_number=<PR#>, body=<report>)`
in the remote/web environment, or `gh pr comment <PR#> --body-file <path>` locally.
- Lead the comment with the **verdict** and the summary table so it's readable at a
  glance; full findings below.
- A PR comment has a ~65 k character limit. If the report exceeds it, post the
  verdict + summary + Critical/High findings inline, and save the full report to
  `docs/reviews/beta-release-review-<YYYY-MM-DD>.md`, linking to it (note in the
  comment that Medium/Low were truncated — never silently).
- Also save a local copy to `docs/reviews/beta-release-review-<YYYY-MM-DD>.md` for
  the record (create `docs/reviews/` if needed).
- **Be frugal with PR comments.** One report comment per run. If you're re-running
  on the same PR, prefer editing/replacing the prior bot comment over stacking a new
  one. Do **not** also leave inline line comments unless the user asked for them.

This skill **only reviews** — it does not fix anything and does not approve/merge
the PR. The human acts on the report.

### Reference workflow shape

Adapt counts to requested depth (see "Scaling"). Mirrors `codebase-review` so the
two feel consistent:

```js
export const meta = {
  name: 'beta-release-review',
  description: 'Release-gate review of a BETA→main PR → report comment + GO/NO-GO',
  phases: [{ title: 'Review' }, { title: 'Verify' }, { title: 'Synthesize' }],
}

const FINDINGS_SCHEMA = { /* array of {id,title,severity,dimension,file,line,
  evidence,impact,recommendation,effort,confidence,blocksRelease} — see report-template.md */ }
const VERDICT_SCHEMA  = { /* {survives:boolean, reason:string, introducedByThisPR:boolean,
  severityAdjust?:string} */ }

const reviewed = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  r => parallel((r.findings || []).map(f => () =>
    agent(`Adversarially REFUTE this finding against the BETA→main diff. Default to ` +
          `survives=false if you cannot confirm it at ${f.file}:${f.line}. Set ` +
          `introducedByThisPR=false if it already exists on main (pre-existing → not a ` +
          `release blocker). Check CLAUDE.md before calling a documented convention a bug.` +
          `\n\n${JSON.stringify(f)}`,
          { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, verdict: v })))),
)

const confirmed = reviewed.flat().filter(Boolean)
  .filter(f => f.verdict?.survives && f.verdict?.introducedByThisPR !== false)
// dedupe by file+line+dimension, apply severityAdjust, sort, compute verdict, write & post.
```

## The seven dimensions (fixed — always all seven)

Run all seven every time, even if some come back empty. The fixed set is what keeps
runs comparable. Dimensions 1 and 7 are release-specific; 2–6 are the usual review
lenses applied to the diff.

1. **Release config & gate correctness** *(signature dimension — weigh heaviest)*
   - **Coach plugin is production in BOTH places:** `package.json` →
     `@perchwerks/eye-in-the-sky` (tilde-pinned published version, **not**
     `@theangryraven/eye-in-the-sky": "github:…#BETA"`), and `vite.config.ts`
     `DEFAULT_PLUGIN_PACKAGES = "@perchwerks/eye-in-the-sky"`. Still on the BETA git
     dep → **Critical, NO-GO.** `bun.lock` must match the chosen package.
   - **Version is set & coherent:** `package.json` `"version"` equals the topmost
     `## [X.Y.Z]` CHANGELOG heading, and that heading is **dated** (not
     `- unreleased`) to the release date.
   - **Changelog is complete:** every user-facing change in the commit/merged-PR
     list is reflected in that section (Golden Rule 4). Missing entries → finding.
   - **No beta/preview-only leakage into the production path:** no `_PREVIEW`
     Supabase creds hard-wired, no `?dbg`/debug flags forced on, no `VITE_IS_NATIVE`
     / admin / cloud env flips, no firmware manifest stuck on the beta channel, no
     `it.only`/`describe.only`, no stray `console.log`, no commented-out scaffolding.
2. **Correctness & robustness** — actual bugs introduced by the diff, unhandled
   errors/rejections, race conditions, stale-closure `setState` gotchas, off-by-one
   in lap/sector math, unit-conversion mistakes, NaN/empty-data handling in parsers.
3. **Security** — focus on the real surface the diff touches: Supabase edge
   functions, cloud sync, admin, auth/JWT, parser input validation (untrusted log
   files), XSS in user-controlled rendering, secrets in client code or git,
   IndexedDB/localStorage trust boundaries, CAPTCHA/rate-limit bypass. Don't invent
   server threats where there's no server.
4. **Performance & bundle budget** — render hot paths (per-tick playback, canvas
   charts, Leaflet), parser throughput, leaks (listeners, workers, object URLs), and
   especially **bundle-budget regressions**: an eager import that re-merges a lazy or
   `vendor-supabase` chunk into the landing payload (see CLAUDE.md's bundle-splitting
   rules — a static `@/integrations/supabase/client` reachable from `Index.tsx`/
   `LandingPage` is a known landmine).
5. **Testing & regression coverage** — new parsers / pure utilities / protocol-format
   logic in the diff MUST ship with tests (Golden Rule 3); bug fixes need a
   regression test; check coverage floors in `lib/`/`hooks/`/`plugins/` aren't
   lowered.
6. **Docs & changelog sync** — `README`, `CLAUDE.md`, `docs/*`, and `CreditsDialog`
   updated alongside code that makes them stale (parsers, env vars, dependencies,
   architecture). New FOSS dependency → Credits updated and README Credits ==
   `CreditsDialog`. `docs/ble-protocol.md` in sync with any BLE wire-format change.
7. **Merge & migration integrity** — merge conflicts resolved sanely (no lost or
   doubled changes), no main-only hotfix silently dropped by the merge, no change on
   BETA accidentally reverted, and any new/changed IndexedDB store carries a
   `DB_VERSION` bump + migration in `openDB()` (CLAUDE.md storage rules).

## Severity rubric (fixed — apply consistently)

Assign exactly one. When uncertain, justify against the definition rather than
guessing.

- **Critical** — ships a broken/insecure release: exploitable security hole, data
  loss/corruption, a core offline feature broken for users, or the **coach still on
  the BETA git dependency**. Always NO-GO.
- **High** — serious bug, a Golden-Rule violation with real consequences (untested
  parser path, wrong/undated version, changelog missing real changes, bundle-budget
  regression), or a merge that dropped/reverted intended work. Block or fix-before-merge.
- **Medium** — meaningful coupling/duplication introduced, a missing-but-not-critical
  test, a user-noticeable perf issue, a convention violation, doc drift on a touched
  surface. Should fix; rarely blocks alone.
- **Low** — polish: naming, minor dead code, micro-optimizations, cosmetic doc drift.

Down-rank anything you cannot verify at a specific `file:line` in the diff; a finding
with no location is not a finding. Pre-existing issues already on `main` are out of
scope — only what this PR introduces or leaves unfinished counts toward the verdict.

## Release verdict (the headline of the comment)

Compute from the confirmed, release-introduced findings:

- **NO-GO** — any **Critical**, or any **High** that breaks the release contract
  (coach not flipped, version/changelog wrong, intended work dropped by the merge).
  Do not merge until resolved.
- **GO-WITH-FIXES** — no Critical; one or more High/Medium that should be fixed but
  could be hotfixed or are low-risk to defer. List the must-fix subset explicitly.
- **GO** — nothing above Medium, release contract satisfied (coach production,
  version set & dated, changelog complete, CI green). Safe to merge and tag.

State the verdict in one line at the very top of the report and the PR comment, with
a one-sentence justification and the blocker count.

## Scaling to requested depth

- **Default / "review the release PR"** — all seven dimensions, single adversarial
  verify per finding, full report comment.
- **"thorough" / "be exhaustive" / large token budget** — split heavy dimensions
  across multiple finders (e.g. security: edge-functions vs client vs parsers; or
  one correctness finder per large subsystem touched), use a 3-vote
  perspective-diverse verify (correctness lens / "already-handled or pre-existing"
  lens / "intended per docs" lens; survive on majority), and add a completeness-critic
  pass ("what touched area or whole commit did we not review?").
- **"quick" / "just the blockers"** — dimension 1 + correctness + security only,
  report Critical/High and the GO/NO-GO verdict, still verify.

Always `log()` (and note in the report's "What was not covered") anything you
capped or skipped — silent truncation reads as "covered everything" when it didn't.
