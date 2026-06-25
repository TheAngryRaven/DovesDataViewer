# Report format — `codebase-review`

The synthesis step writes exactly this shape so every run is comparable. Save to
`docs/reviews/codebase-review-<YYYY-MM-DD>.md`.

## Finding object (structured output)

Each finding the finder/verifier agents return:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable-ish slug, e.g. `SEC-01`, `ARCH-03` (dimension prefix + number) |
| `title` | string | One line, specific. "God file: Index.tsx mixes 9 concerns", not "big file" |
| `severity` | `Critical` \| `High` \| `Medium` \| `Low` | Per the rubric in SKILL.md |
| `dimension` | enum | One of the seven dimension keys below |
| `file` | string | Repo-relative path |
| `line` | number \| range | Required. No location → not a finding |
| `evidence` | string | What's actually there — quote/paraphrase the code, don't assert |
| `impact` | string | Why it matters, in this project's terms (offline-first, FOSS, users) |
| `recommendation` | string | Concrete fix direction, not "consider improving" |
| `effort` | `S` \| `M` \| `L` | Rough fix size |
| `confidence` | `High` \| `Medium` \| `Low` | After adversarial verify |

Dimension keys: `architecture`, `security`, `performance`, `correctness`, `testing`,
`ci`, `quality`.

## Output Markdown structure

```markdown
# Codebase Review — <YYYY-MM-DD>

**Project:** Dove's DataViewer / LapWing (FOSS, GPLv3, offline-first PWA)
**Scope:** <branches/commit reviewed> · **Run:** multi-agent (<N> finders, <verify mode>)
**Excluded:** node_modules, dist, generated supabase client, lockfiles

## Summary

| Severity | Count |
|----------|-------|
| Critical | n |
| High     | n |
| Medium   | n |
| Low      | n |

<2-4 sentence honest verdict: what's solid, what's the systemic weakness.>

## Findings (sorted: Critical → Low, then by dimension)

### [SEVERITY] <id> — <title>
- **Dimension:** <dimension>
- **Location:** `path/to/file.ts:line`
- **Evidence:** <what's there>
- **Impact:** <why it matters>
- **Recommendation:** <concrete fix>
- **Effort:** S/M/L · **Confidence:** High/Med/Low

<repeat per finding, Critical first>

## Themes & systemic issues

<Cross-cutting patterns the individual findings point to — e.g. "tests trail parsers",
"coupling concentrated in Index.tsx". This is the part a human acts on strategically.>

## What was not covered

<Any dimension capped, area skipped, or finding dropped for lack of verification.
Be honest — silent gaps make the next run look like a regression.>
```

Keep the report self-contained: a contributor should be able to work the list top-down
without re-running the audit.
