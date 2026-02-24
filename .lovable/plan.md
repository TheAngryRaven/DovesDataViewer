

# Create CLAUDE.md for Cross-Tool Development

## What

Create a `CLAUDE.md` file at the project root that gives Claude Code (and any other AI tool) a comprehensive, concise map of the codebase. This file will be the single source of truth for any AI agent working on this project -- covering architecture, conventions, file locations, data flow, and gotchas.

Regarding Lovable: Lovable uses "Custom Knowledge" in project settings (which you already have configured) rather than a file. The existing custom knowledge entries already cover the key rules (offline-first, modular, README updates, credits list). No additional Lovable-specific file is needed -- the custom knowledge system is the equivalent.

## Why

As firmware features grow and Claude Code takes on more of the device-side work, both tools need a shared understanding of the webapp's architecture without burning tokens re-exploring the codebase every session.

## What Goes in CLAUDE.md

Following best practices (under 300 lines, hand-crafted, universally applicable, pointers not copies):

### Sections

1. **Project identity** -- One-liner: what this is, live URL, companion hardware repo
2. **Philosophy / golden rules** -- Offline-first (99% client-side), modular/reusable, update README on parser/env changes, update credits on new FOSS deps
3. **Tech stack** -- React 18, Vite, Tailwind, Leaflet, custom Canvas charts, IndexedDB for all local storage, optional admin backend
4. **Architecture map** -- Directory tree with purpose annotations for every key directory and file category
5. **Data flow** -- How a file goes from import to parsed data to lap calculation to visualization (the critical pipeline)
6. **Parser system** -- How auto-detection works (`datalogParser.ts` routes to format-specific parsers), how to add a new parser (implement `isXxxFormat()` + `parseXxxFile()`, register in `datalogParser.ts`, update README)
7. **Core types** -- Pointer to `src/types/racing.ts` with summary of `GpsSample`, `ParsedData`, `Lap`, `Course`, `Track`
8. **Storage layer** -- IndexedDB via `dbUtils.ts` (shared DB, 7 object stores), individual storage modules (files, metadata, karts, notes, setups, video-sync, graph-prefs), localStorage for user tracks and settings
9. **BLE integration** -- `bleDatalogger.ts` handles Web Bluetooth connection to DovesLapTimer device, `DataloggerDownload.tsx` is the UI. BLE UUIDs, protocol (LIST, GET:filename, SIZE/DONE/ERROR status)
10. **Settings** -- `useSettings` hook + `SettingsContext` for runtime distribution, `fieldResolver.ts` for canonical field name mapping across parsers
11. **Admin system** -- Optional, behind `VITE_ENABLE_ADMIN`, modular DB layer (`src/lib/db/`), edge functions
12. **Environment variables** -- Table of all env vars with descriptions
13. **Commands** -- dev, build, lint
14. **Key conventions** -- No server-side when client-side works, keep hooks composable, parsers export `isXxxFormat()` + `parseXxxFile()`, all IndexedDB stores registered in `dbUtils.ts`

## File to Create

- `CLAUDE.md` (project root, ~200-250 lines)

## Technical Details

The file will reference but not duplicate content from README.md. It focuses on what an AI agent needs to know to make correct code changes: where things live, how they connect, and what rules to follow.
