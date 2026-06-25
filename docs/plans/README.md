# Plans — numbered design records

This folder holds **design plans**: the internal thinking behind a chunk of work —
*how* it was built and, more importantly, *why*. They exist so we (and AI agents)
can recover the rationale behind a subsystem without burning tokens re-researching
the code. Read the relevant plan before changing the area it covers.

## Naming — numbered, sequential

Every plan is prefixed with a **zero-padded sequence number** and a short slug:

```
0000-multi-lap-overlay.md
0001-firmware-bluetooth-dfu.md
0002-firmware-sdcard-ota.md
0003-lap-sector-overhaul.md
0004-i18n-translation-system.md
```

**To add a plan:** take the **next number after the highest one in this folder**
(don't reuse or backfill gaps), pick a short kebab-case slug, and write
`NNNN-slug.md`. The number is permanent — renaming would break references, so it
stays even if the slug later feels dated.

## Keeping plans current

- **Update a plan while you execute it** — as decisions change, the plan should
  reflect what was actually built, not just the original intent.
- **Only revisit an older plan later if you're working in code that references it.**
  Don't sweep through and "refresh" plans speculatively; touch a plan when its area
  is in play.

## Commit messages must cite the plan number

Any commit that is part of executing a plan **must reference the plan number** in
its message — `plan 0004:` as a prefix, or `(plan 0004)` inline. That's what lets
someone reading `git log` jump straight from a change back to the reasoning behind
it. (Golden Rule 8 in `CLAUDE.md`.)

## What a plan should contain

No rigid template, but a good plan covers:
- **Goal / problem** — what we're solving and why it matters here (offline-first,
  FOSS, the specific user need).
- **Approach & key decisions** — the design chosen and the alternatives rejected,
  with the *why*. This is the most valuable part.
- **Touch points** — the files/modules/subsystems involved.
- **Status / phasing** — what's done, what's pending, any follow-ups.

Plans are referenced from code comments and `docs/*` (e.g. `docs/ble.md`,
`docs/i18n.md`, `docs/subsystems.md`) — when you renumber or move one, update those
references too (Golden Rule 5).
