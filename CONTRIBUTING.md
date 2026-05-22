# Contributing to Dove's DataViewer

Thanks for your interest in improving Dove's DataViewer! This is an
offline-first, open-source motorsport telemetry viewer, and contributions of
all kinds are welcome — new file-format parsers, bug fixes, overlays, docs, and
reusability rewrites especially.

By participating, you agree to abide by our Code of Conduct (`CODE_OF_CONDUCT.md`).

---

## Guiding Principles

These are the rules the project lives by — please keep them in mind:

1. **Offline-first.** 99% of features must work with no network. Only weather,
   satellite map tiles, and the optional admin backend are allowed to require
   connectivity.
2. **Never do on the server what you can do on the client.** Telemetry parsing,
   lap detection, and visualization all happen in the browser. Data never
   leaves the user's device.
3. **Modular & reusable.** Prefer small, composable modules over monoliths.
   Rewrites that make code more reusable are always welcome — line count is not
   a concern.
4. **Keep docs in sync.** Update `README.md` when you add a parser, change an
   env var, or modify build params. Update the Credits list when you add a FOSS
   dependency. Update `CLAUDE.md` with new files/architecture notes.

---

## Development Setup

### Prerequisites

- Node.js 18+ (or [Bun](https://bun.sh))

### Getting started

```bash
git clone https://github.com/TheAngryRaven/DovesDataViewer.git
cd DovesDataViewer
npm install
npm run dev      # dev server on http://localhost:8080
```

The core app needs **no environment variables** — it runs fully offline. Env
vars are only required for the optional admin backend (see the README).

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on port 8080 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | Type-check via `tsc -b` |
| `npm test` | Vitest (watch) |
| `npm run test:run` | Vitest (single pass, CI-style) |

> **Note on typechecking:** always use `npm run typecheck` (`tsc -b`), not a
> bare `tsc --noEmit`. The root `tsconfig.json` uses project references; plain
> `tsc` from the root silently checks nothing and exits 0.

---

## Before You Open a PR

Run the same four checks CI runs, and make sure they pass:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

CI runs these as four separate workflows on every PR. A PR won't be merged
until all four are green.

---

## Adding a New Parser

The parser system is the most common contribution. Each parser is
self-contained and auto-detected on import.

1. Create `src/lib/xxxParser.ts` exporting two functions:
   - `isXxxFormat(input: string | ArrayBuffer): boolean` — format detection
   - `parseXxxFile(input: string | ArrayBuffer): ParsedData` — full parse
2. Register it in `src/lib/datalogParser.ts` — add the import and a detection
   check in **both** `parseDatalogFile()` and `parseDatalogContent()`.
3. Respect detection order: binary formats first (MoTeC LD → UBX), then text
   formats from most-specific to least (VBO → MoTeC CSV → Dovex → Dove →
   Alfano → AiM → NMEA fallback).
4. Add tests with a representative sample.
5. Update the **Supported File Formats** table in `README.md` and the parser
   list in `CLAUDE.md`.

See `src/types/racing.ts` for the `ParsedData` / `GpsSample` shapes your parser
must produce, and `src/lib/parserUtils.ts` for shared helpers (haversine, speed
calculation, etc.).

---

## Coding Conventions

- **TypeScript + React 18.** Function components and hooks only.
- **Hooks are composable** — each hook does one thing; `Index.tsx` orchestrates.
- **Styling:** Tailwind semantic tokens from `index.css`. Never hardcode colors
  in components.
- **Comments:** write them only when the *why* is non-obvious. Well-named code
  documents the *what*.
- **Admin code** is fully optional and gated behind env vars — the core app
  must have zero admin dependencies.
- Keep the initial bundle small: respect the `React.lazy` boundaries and
  `manualChunks` vendor splits described in `CLAUDE.md`.

`CLAUDE.md` at the repo root is the detailed architecture map — it's the best
single reference for how everything fits together.

---

## Pull Request Process

1. Fork the repo and create a topic branch (`feat/...`, `fix/...`, `chore/...`).
2. Make focused commits with clear messages.
3. Ensure lint, typecheck, tests, and build all pass locally.
4. Update relevant docs (`README.md`, `CLAUDE.md`, Credits) as noted above.
5. Open a PR against `main` and fill out the PR template.

---

## Reporting Bugs & Requesting Features

Use the GitHub issue templates. For bugs, include the file format involved
(parsers are format-specific) and, where possible, a sample file or the steps
to reproduce.

**Security issues:** please do **not** open a public issue — follow the
disclosure process in `SECURITY.md`.
