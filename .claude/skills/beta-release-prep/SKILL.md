---
name: beta-release-prep
description: Prepare the BETA branch for release into main. Use when the user wants to "prep beta", "cut a release", "get beta ready for main", or "do release prep". Researches every commit between the last release tag and BETA to verify the CHANGELOG is complete and to build release notes, creates a release branch off BETA, flips the eye-in-the-sky coach plugin from the BETA git dependency to the published production npm package, sets the version in package.json to match the topmost unreleased CHANGELOG heading, dates that heading to today, runs the green-before-merge checks, opens a PR into BETA, ensures a BETA→main PR exists whose body is copy-paste-ready release notes, and opens a follow-up "flip coach back to BETA" PR to merge after release. Documents the manual post-release tag + back-merge of main into BETA. Never creates tags.
---

# Beta → Main Release Prep

Automates the release-prep checklist for Dove's DataViewer / LapWing: get the
`BETA` branch ready to merge into `main`. The headline gotcha this skill exists
to catch: **the coach plugin (`eye-in-the-sky`) must be on the published
production npm package on `main`, but during BETA development it points at the
coach repo's git branch — and people forget to flip it.**

> Read `CLAUDE.md` → the "⚠️ SUPER IMPORTANT — coach source differs by branch"
> block before running this. This skill operationalizes that block.

## The two coach-source states (the only lines that differ between BETA and main)

| | `package.json` dependency | `vite.config.ts` `DEFAULT_PLUGIN_PACKAGES` |
|---|---|---|
| **Production (main)** | `"@perchwerks/eye-in-the-sky": "~<x.y.z>"` (tilde-pinned published release) | `"@perchwerks/eye-in-the-sky"` |
| **BETA (dev)** | `"@theangryraven/eye-in-the-sky": "github:TheAngryRaven/DataViewer_coach#BETA"` | `"@theangryraven/eye-in-the-sky"` |

These two lines — `package.json` and `vite.config.ts` line ~156 — are the
**only** ones that change between the states. Nothing else about the coach moves.

## Hard rules

- **NEVER create or push a git tag.** Tagging from Claude errors out. The
  maintainer tags the release manually after merge. Do not run `git tag` or
  `git push --tags`.
- **NEVER push to `BETA` or `main` directly.** All changes go through PRs.
- Work happens on a fresh branch cut from the current `origin/BETA`.
- The skill is **idempotent**: if the coach is already on production, leave it;
  if the CHANGELOG is already dated, don't re-date it. Report what was already
  correct rather than forcing a no-op change.

## Procedure

### 0. Sync and branch

```bash
git fetch --all --prune --tags
```

Cut the release branch from `origin/BETA` (not from your current HEAD):

```bash
git switch -c release/v<X.Y.Z> origin/BETA   # name decided in step 2
```

If you must name the branch before knowing the version, use a placeholder like
`release/beta-prep` and rename once the version is known, or just keep the
descriptive name you were given. The important part is that it is based on
`origin/BETA` and contains a clean tree.

### 0.5. Research the commits since the last release

Releases are tagged on `main` (e.g. `v2.9.1`). The maintainer tags manually
after merge, so the **latest tag is the last shipped version**. Diff every commit
between it and `BETA` — this drives both a CHANGELOG-completeness check and the
release notes in step 6.

```bash
LAST_TAG=$(git tag --sort=-v:refname | head -1)
echo "Last released tag: $LAST_TAG"
git log "$LAST_TAG"..origin/BETA --oneline                  # full commit list
git log "$LAST_TAG"..origin/BETA --oneline --merges         # merged PRs (often the cleanest summary)
git diff "$LAST_TAG"..origin/BETA --stat                    # what changed, by file
```

> The tag lives on `main` and (due to the back-merge model — see "Post-release
> back-merge" below) may **not** be an ancestor of `BETA`. That's fine: the
> tagged commit still has `BETA`'s previously-released history as ancestors, so
> `"$LAST_TAG"..origin/BETA` correctly lists only the *new* commits since release.

**Use this to verify the CHANGELOG is complete.** Walk the merged-PR / commit
list and confirm every user-facing change is reflected under the topmost
`## [X.Y.Z] - unreleased` heading. If something user-facing is missing, add it to
that section before continuing (the changelog is part of the change — Golden Rule
4). Internal-only commits (CI, tests, refactors with no user impact) don't need a
changelog line. Keep the raw `git log` output around — step 6 reuses it.

### 1. Flip the coach plugin to production

Inspect the current state first:

```bash
grep -n "eye-in-the-sky" package.json
grep -n "DEFAULT_PLUGIN_PACKAGES" vite.config.ts
```

If it already reads `@perchwerks/eye-in-the-sky` in **both** files, it's already
production — note that and skip the edits. Otherwise:

1. In `package.json`, replace the BETA git dependency line
   ```json
   "@theangryraven/eye-in-the-sky": "github:TheAngryRaven/DataViewer_coach#BETA"
   ```
   with the tilde-pinned published release
   ```json
   "@perchwerks/eye-in-the-sky": "~<x.y.z>"
   ```
   Determine `<x.y.z>` — the published npm version to ship. If the user gave a
   version, use it. Otherwise find the latest published version and **confirm it
   with the user** before pinning (don't guess a coach version silently):
   ```bash
   npm view @perchwerks/eye-in-the-sky version
   ```
2. In `vite.config.ts`, set
   ```ts
   const DEFAULT_PLUGIN_PACKAGES = "@perchwerks/eye-in-the-sky";
   ```
3. Re-resolve the lockfile and install:
   ```bash
   bun install
   ```
   Commit the updated `bun.lock` alongside the two source edits.

### 2. Set the version

The CHANGELOG drives the version. Find the topmost unreleased heading:

```bash
grep -n "unreleased" CHANGELOG.md | head -1
```

That heading is `## [<X.Y.Z>] - unreleased`. Set `package.json` `"version"` to
exactly `<X.Y.Z>`:

```bash
grep -n '"version"' package.json
```

The footer/build version stamp is baked from `package.json` (`vite.config.ts`),
so `package.json` is the only place to edit — there is no second version string
to keep in sync. (`CHANGELOG.md` is the only other place the version appears.)

### 3. Date the changelog

Replace `- unreleased` with today's date on that same topmost heading only:

```
## [<X.Y.Z>] - <YYYY-MM-DD>
```

Use the real current date (the harness provides it; don't hardcode). Leave every
older heading untouched. Do **not** create a new `[Unreleased]` block — per the
changelog rule the next version's block is started after this release ships.

### 4. Green before merge

All four must pass before opening any PR (CI runs them as separate workflows):

```bash
bun run lint
bun run typecheck
bun run test:run
bun run build
```

If any fail, fix forward on this branch before proceeding. The `build` step in
particular validates that the production coach package resolves and bundles.

### 5. Commit and push

```bash
git add package.json vite.config.ts bun.lock CHANGELOG.md
git commit -m "chore(release): prep v<X.Y.Z> — production coach + dated changelog"
git push -u origin release/v<X.Y.Z>
```

(Retry push up to 4× with exponential backoff on network errors only.)
**Do not tag.**

### 6. Open the PRs

Use the available GitHub mechanism — `gh` CLI locally, or the `mcp__github__*`
tools in the remote/web environment. Owner/repo: `TheAngryRaven/DovesDataViewer`.

**PR A — release branch → BETA** (the actual prep change):
- base: `BETA`, head: `release/v<X.Y.Z>`
- title: `Release prep v<X.Y.Z>`
- body: summarize the coach flip (→ production), the version bump, and the dated
  changelog.

**PR B — BETA → main** (the release itself, in preparation):
- First check whether one already exists:
  ```
  list_pull_requests(owner, repo, base="main", head="BETA", state="open")
  ```
- **The body must BE the release notes**, written so the maintainer can
  copy-paste it verbatim into the GitHub Release notes when they tag. Build it
  from the dated `## [X.Y.Z]` CHANGELOG section (the one you just finalized),
  cross-checked against the step 0.5 commit research so nothing user-facing is
  missing. Format:
  - Start with a one-line `## v<X.Y.Z> — <YYYY-MM-DD>` header.
  - Reproduce the CHANGELOG section's `### Added / Changed / Fixed / …`
    subsections and bullets verbatim — this is the human-readable changelog,
    not a commit dump.
  - End with a `**Full changelog:** <LAST_TAG>...v<X.Y.Z>` compare link, e.g.
    `https://github.com/TheAngryRaven/DovesDataViewer/compare/<LAST_TAG>...main`.
  - Do **not** append the Claude/Co-Authored-By footer to this body — it's
    release-notes copy, not a normal PR description.
- **If the PR already exists**, don't open a duplicate — instead update its body
  to the freshly-generated release notes (`update_pull_request`) so it stays
  copy-paste ready, and note its number/URL.
- If it doesn't exist, create it: base `main`, head `BETA`,
  title `Release v<X.Y.Z>`, body = the release notes above. It may stay a draft
  until PR A lands.

**PR C — flip the coach back to BETA** (post-release cleanup, opened now):
- Cut another branch from `origin/BETA`:
  ```bash
  git switch -c chore/coach-back-to-beta origin/BETA
  ```
- Apply the **reverse** of step 1: `package.json` →
  `"@theangryraven/eye-in-the-sky": "github:TheAngryRaven/DataViewer_coach#BETA"`,
  `vite.config.ts` → `DEFAULT_PLUGIN_PACKAGES = "@theangryraven/eye-in-the-sky"`,
  then `bun install`. Commit and push.
- Open PR: base `BETA`, head `chore/coach-back-to-beta`.
- **Title must signal ordering**, e.g.
  `[DO NOT MERGE YET] Flip coach back to BETA — merge AFTER beta is merged into main`
- body: explain this restores BETA's git-dependency coach source and must only be
  merged once PR B (BETA → main) has merged, so the release isn't undone.

### 7. Report

Summarize for the user: the release version, whether the coach needed flipping or
was already production, the three PR URLs (noting if PR B already existed /
was updated), and an explicit reminder that **no tag was created** — they tag
manually after merge. Then remind them of the two manual post-release steps below.

## Post-release: tag, then back-merge main into BETA (manual, after merge)

This skill stops at *prep* — it can't tag or back-merge, because at prep time the
release isn't merged into `main` yet. Once the maintainer merges **PR B
(BETA → main)**, two things happen in order:

1. **Tag the release on `main`** (maintainer does this by hand — Claude tagging
   errors out). The tag (`v<X.Y.Z>`) lands on the `main` merge commit.
2. **Back-merge `main` into `BETA`.** This is the part that's easy to forget and
   the reason `git describe` / "commits since last tag" goes wrong over time.

**Why the back-merge is required.** Merging `BETA → main` creates a merge commit
on `main`; the tag sits on `main` only and is **never** copied to `BETA`. So
`BETA` and `main` diverge — the tag isn't an ancestor of `BETA`, `git describe`
from `BETA` can't find the latest release, and the gap compounds with every
release (you can confirm with `git merge-base --is-ancestor v<X.Y.Z> origin/BETA`
returning non-zero). Merging `main` back into `BETA` reconverges the branches so
the tag is reachable from `BETA` again. This is the existing `Main2beta-*` branch
pattern in the repo history.

Do it via a normal PR (don't push to `BETA` directly):

```bash
git fetch --all --tags
git switch -c chore/main-back-to-beta origin/main
git push -u origin chore/main-back-to-beta
# open PR: base BETA, head chore/main-back-to-beta, title "Back-merge main → BETA after v<X.Y.Z>"
```

> Order matters: merge **PR C (flip coach back to BETA)** and this back-merge into
> `BETA` *after* the release is on `main`. If PR C's coach revert lands on `BETA`
> before `BETA → main` merges, the release ships with the BETA git-dependency
> coach — the exact bug this whole skill exists to prevent.

## Notes & edge cases

- If the working tree is dirty at the start, stop and ask the user — don't stash
  or discard their work.
- If there is no `unreleased` heading in the CHANGELOG, the release version is
  ambiguous — ask the user which version is being cut.
- A git dependency records the resolved coach commit in `bun.lock`; flipping to
  the npm package changes the lockfile, which is expected and must be committed.
- If `bun install` can't reach the registry in a restricted network, surface the
  error — don't hand-edit `bun.lock`.
