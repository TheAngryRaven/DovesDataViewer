---
name: codebase-review
description: >-
  Deep, multi-agent professional code-review audit of the WHOLE codebase (not the
  working diff). Use when the user asks for a "deep dive", "harsh review", "audit",
  "professional review", "find all the issues", or otherwise wants a prioritized
  backlog of everything wrong with the project — architecture/modularity, coupling,
  god files, security, performance, testing/regression coverage, and CI. Produces a
  single severity-sorted Markdown report. For reviewing the current diff/PR instead,
  use the built-in `code-review` skill.
---

# Codebase Review — whole-project professional audit

A repeatable, opinionated, multi-agent audit of the **entire** codebase. The goal is
a **consistent** result every run: the same dimensions, the same severity rubric, and
the same report shape, so two runs on the same code produce comparable backlogs.

This is **not** the diff reviewer. It audits the whole tree and writes a standalone,
prioritized report the user can work through.

## Context this project assumes

- **FOSS, GPLv3, publicly released (v1.5.0+).** Judge it at professional OSS standards.
- **Offline-first PWA** — Golden Rule 1: "never do on the server what you can do on the
  client." Server-only surfaces (Supabase edge functions, cloud sync, admin) are the
  exception, not the rule, and carry the real security surface.
- The durable conventions live in `CLAUDE.md` and `docs/`. **Treat documented Golden
  Rules and conventions as the standard** — a violation of a stated rule is a finding.
- Toolchain is **Bun + Vite + React 18 + TS + Vitest**. CI is five workflows
  (`lint`, `typecheck`, `test`, `build`, `coverage`).

## How to run it

This is an explicit opt-in to multi-agent orchestration: **run it as a `Workflow`.**
A workflow is what makes the result repeatable — fixed fan-out, fixed dimensions,
adversarial verification, deterministic synthesis. Do not freelance a single-agent
sweep instead.

1. **Scope the tree first (inline, cheap).** Establish the work-list before fanning out:
   - Source under `src/`, edge functions under `supabase/functions/`, build config
     (`vite.config.ts`, `wrangler.jsonc`), CI under `.github/workflows/`.
   - **Exclude** `node_modules/`, `dist/`, `bun.lock`, `src/integrations/supabase/`
     (generated — do not flag), `*.test.ts` fixtures-as-noise, and vendored assets.
   - Note the biggest files (god-file candidates) with a quick line-count sweep —
     `Index.tsx` is the known orchestrator; size alone is not a finding, but
     size + mixed responsibilities is.

2. **Fan out one agent per dimension** (the seven below). Each agent is a harsh,
   skeptical senior reviewer for ITS dimension only, returns **structured findings**,
   and must cite `file:line`. An agent that finds nothing returns an empty list — do
   not pad.

3. **Adversarially verify every finding** before it lands. A separate agent tries to
   **refute** each finding ("is this actually true at this line? is it already handled
   elsewhere? is it intended per CLAUDE.md?"). Drop findings that don't survive. This
   is the single biggest lever on repeatability — it kills the plausible-but-wrong
   findings that make runs differ.

4. **Synthesize** the surviving findings into ONE report, deduped across dimensions,
   sorted by severity then dimension, using the template in `report-template.md`.

5. **Write the report** to `docs/reviews/codebase-review-<YYYY-MM-DD>.md` (create
   `docs/reviews/` if needed). Tell the user the path and give them the top findings
   inline. Do **not** fix anything — this skill only produces the backlog.

### Reference workflow shape

Use this structure (adapt counts to requested depth — see "Scaling"):

```js
export const meta = {
  name: 'codebase-review',
  description: 'Whole-codebase professional audit → severity-sorted report',
  phases: [{ title: 'Review' }, { title: 'Verify' }, { title: 'Synthesize' }],
}

const FINDINGS_SCHEMA = { /* array of {id,title,severity,dimension,file,line,
  evidence,impact,recommendation,effort,confidence} — see report-template.md */ }
const VERDICT_SCHEMA  = { /* {survives:boolean, reason:string, severityAdjust?:string} */ }

// one finder per dimension; each finding verifies as soon as its dimension returns
const reviewed = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }),
  r => parallel((r.findings || []).map(f => () =>
    agent(`Adversarially REFUTE this finding. Default to survives=false if you cannot ` +
          `confirm it at ${f.file}:${f.line}. Check CLAUDE.md before calling a documented ` +
          `convention a bug.\n\n${JSON.stringify(f)}`,
          { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, verdict: v })))),
)

const confirmed = reviewed.flat().filter(Boolean).filter(f => f.verdict?.survives)
// dedupe by file+line+dimension, apply any severityAdjust, then sort & write the report.
```

## The seven dimensions (fixed — always all seven)

Run all seven every time, even if some come back empty. This fixed set is what keeps
runs comparable.

1. **Architecture & modularity** — coupling, cohesion, god files/classes, leaky
   abstractions, circular deps, duplication, violations of the documented architecture
   (hooks-do-one-thing, `Index.tsx` orchestrates, parser contract, plugin contract,
   single-source-of-truth modules like `courseSectors.ts`/`channels.ts`).
2. **Security** — focus on the real surface: Supabase edge functions, cloud sync,
   admin, auth/JWT handling, input validation on parsers (untrusted log files!), XSS in
   user-controlled rendering, secrets in client code or git, IndexedDB/localStorage
   trust boundaries, CAPTCHA/rate-limit bypass. Remember offline-first: most of the app
   has no server surface — don't invent server threats where there's no server.
3. **Performance** — render hot paths (per-tick playback, canvas charts, Leaflet),
   parser throughput on large logs, memory/leaks (event listeners, workers, object
   URLs), bundle budget regressions (eager imports of lazy/`vendor-supabase` chunks —
   see CLAUDE.md's bundle-splitting rules), unnecessary re-renders (SessionContext
   churn).
4. **Correctness & robustness** — actual bugs, unhandled errors/rejections, race
   conditions, stale-closure `setState` gotchas, off-by-one in lap/sector math, unit
   conversion mistakes, NaN/empty-data handling in parsers.
5. **Testing & regression coverage** — untested parsers/pure utilities/protocol logic
   (Golden Rule 3 says these MUST ship with tests), missing regression tests, weak
   assertions, coverage gaps in `lib/`/`hooks/`/`plugins/`, flaky patterns.
6. **CI/CD & release hygiene** — the five workflows, `--frozen-lockfile`, coverage
   thresholds as floors, deploy config (`wrangler.jsonc`, beta-proxy), preview-backend
   selection, anything that lets red merge to green.
7. **Code quality & convention adherence** — dead code (Golden Rule 7: delete, don't
   comment out), leftover `console.log`, `any` abuse, naming, error-swallowing, stale
   docs (`README`/`CLAUDE.md`/`docs/`/`CreditsDialog` out of sync with code), and
   direct violations of the stated Golden Rules.

## Severity rubric (fixed — apply consistently)

Assign exactly one. Repeatability depends on applying these the same way every run, so
when uncertain, justify against the definition rather than guessing.

- **Critical** — exploitable security hole, data loss/corruption, or a defect that
  breaks a core offline feature for users. Fix before anything else.
- **High** — serious bug, a Golden-Rule violation with real consequences, a god file
  that actively blocks change, or an untested parser/format path (per Rule 3). Should
  fix soon.
- **Medium** — meaningful coupling/duplication, a missing-but-not-critical test, a
  performance issue users could notice, a convention violation. Fix when touching the
  area.
- **Low** — polish: naming, minor dead code, doc drift, micro-optimizations. Nice to
  have.

Down-rank anything you cannot verify at a specific `file:line`; a finding with no
location is not a finding.

## Scaling to requested depth

- **Default / "harsh deep dive"** — all seven dimensions, single adversarial verify per
  finding. This matches the user's standing ask.
- **"thorough" / "be exhaustive" / large token budget** — split big dimensions across
  multiple finders (e.g. security: edge-functions vs client vs parsers), use a 3-vote
  perspective-diverse verify (correctness lens, "already-handled" lens, "intended per
  docs" lens; survive on majority), and add a completeness-critic pass ("what whole
  area did we not look at?").
- **"quick" / "just the big stuff"** — fewer finders, report Critical+High only, still
  verify.

Always `log()` anything you deliberately skipped or capped — silent truncation reads as
"covered everything" when it didn't.
