# Report format — `beta-release-review`

The synthesis step writes exactly this shape so every run is comparable. The report
is posted as a **comment on the BETA → main PR**, and a copy is saved to
`docs/reviews/beta-release-review-<YYYY-MM-DD>.md`.

## Finding object (structured output)

Each finding the finder/verifier agents return:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable-ish slug, e.g. `REL-01`, `SEC-03` (dimension prefix + number) |
| `title` | string | One line, specific. "Coach still on BETA git dep in package.json", not "config issue" |
| `severity` | `Critical` \| `High` \| `Medium` \| `Low` | Per the rubric in SKILL.md |
| `dimension` | enum | One of the seven dimension keys below |
| `file` | string | Repo-relative path (the file as changed in the diff) |
| `line` | number \| range | Required. No location → not a finding |
| `evidence` | string | What's actually in the diff — quote/paraphrase, don't assert |
| `impact` | string | Why it matters for shipping to production users today |
| `recommendation` | string | Concrete fix direction, not "consider improving" |
| `effort` | `S` \| `M` \| `L` | Rough fix size |
| `confidence` | `High` \| `Medium` \| `Low` | After adversarial verify |
| `blocksRelease` | boolean | True if this alone forces NO-GO (drives the verdict) |

Dimension keys: `release-config`, `correctness`, `security`, `performance`,
`testing`, `docs`, `merge-integrity`.

## Output Markdown structure

```markdown
# Beta → Main Release Review — <YYYY-MM-DD>

## 🚦 Verdict: **<GO | GO-WITH-FIXES | NO-GO>**
<One sentence: why. Blockers: <n> Critical, <n> release-blocking High.>

**PR:** #<num> (`BETA` → `main`) · **Release:** v<X.Y.Z> · **Since:** <LAST_TAG>
**Run:** multi-agent (<N> finders, <verify mode>) · **Diff:** <files changed>, <commits> commits
**Excluded:** node_modules, dist, generated supabase client, lockfile line-noise

### Release contract checklist
| Gate | Status |
|------|--------|
| Coach on production npm (`@perchwerks/eye-in-the-sky`, both package.json + vite.config.ts) | ✅ / ❌ |
| `package.json` version == topmost CHANGELOG heading | ✅ / ❌ |
| CHANGELOG heading dated (not `- unreleased`) | ✅ / ❌ |
| CHANGELOG complete vs commits in this release | ✅ / ❌ |
| No beta/preview-only config leaked into prod path | ✅ / ❌ |
| CI green (lint / typecheck / test / build / coverage) | ✅ / ❌ / unknown |

## Summary

| Severity | Count |
|----------|-------|
| Critical | n |
| High     | n |
| Medium   | n |
| Low      | n |

<2-4 sentence honest verdict: is this release safe to ship, and what's the main risk.>

## Findings (sorted: Critical → Low, then by dimension)

### [SEVERITY] <id> — <title>
- **Dimension:** <dimension> · **Blocks release:** yes/no
- **Location:** `path/to/file.ts:line`
- **Evidence:** <what's in the diff>
- **Impact:** <why it matters for this release>
- **Recommendation:** <concrete fix>
- **Effort:** S/M/L · **Confidence:** High/Med/Low

<repeat per finding, Critical first>

## Must-fix before merge

<The explicit subset that gates the release — the blockers. If GO, write "None.">

## Themes & systemic notes

<Cross-cutting patterns across this release's changes — e.g. "new parser shipped
without tests", "changelog trails the actual diff".>

## What was not covered

<Any dimension capped, area skipped, finding dropped for lack of verification, or
pre-existing main issues noted but excluded from the verdict. Be honest — silent
gaps make the next run look like a regression.>
```

Keep the report self-contained: a maintainer should be able to act on the verdict and
the must-fix list without re-running the review. Lead the PR comment with the verdict
and the release-contract checklist — those are what a reviewer reads first.
