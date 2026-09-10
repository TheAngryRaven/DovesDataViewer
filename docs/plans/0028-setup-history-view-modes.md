# Setup history view modes — record every edit, toggle Used / All

> Status: **LANDED.** Builds on the setup-revision model documented in
> `docs/subsystems.md` → *Setup Revisions*.

## Problem

Opening a setup's history (SetupsTab → book icon) only ever showed the states
that had been assigned to a session. That was a direct consequence of two
earlier decisions: a `SetupRevision` was frozen **only** on session assignment
(`useSessionMetadata.handleSaveSessionSetup`), and the orphan prune swept any
revision no session referenced within ~3 days. So plain edits — the "I tried
+1 toe on Tuesday and backed it out Wednesday" story — left no trace at all.
The maintainer's ask: a general history, with a **Used / All** toggle where the
used revisions are marked in the *All* view.

## Approach & key decisions

1. **Freeze on every save.** `useSetupManager.addSetup`/`updateSetup` call
   `freezeSetupRevision` right after `saveSetup`. The hook is the only writer
   of setups from the UI; the cloud-sync accessor writes pulled setups
   directly, so a pull never re-freezes (the originating device already did).
   Content addressing means an unchanged save is a free no-op — no duplicate
   rows, no sync churn. *Rejected:* freezing inside `saveSetup` itself —
   `setupRevisionStorage` imports `setupStorage`, so that would be a cycle,
   and it would make sync pulls freeze too.
2. **Prune rule narrowed.** A revision is now an orphan only when no
   `FileMetadata.sessionSetupRev` references it **and** its live setup has been
   deleted (`findOrphanRevisionIds(revisions, referenced, liveSetupIds)`).
   Every revision of a still-existing setup is its edit history and stays.
   Deleting a setup still lets the sweep reclaim its unused revisions; a
   referenced revision survives the setup's deletion as before. The cloud
   tombstone behaviour is untouched. *Rejected:* dropping the prune entirely
   (deleted setups would leak revisions forever) and a cap on revisions per
   setup (arbitrary, and the docs budget already governs cloud volume).
3. **View mode in the pure model.** `SetupHistoryFilter.view: "used" | "all"`
   (default `used`, which matches what users saw before). `buildSetupHistory`
   aggregates every revision, marks `entry.used = usages.length > 0` **after**
   the kart/course filter, then keeps only the used ones in the `used` view.
   Because the marker and the filter share the same usage list, the *Used*
   list and the *All* badges always agree. Diffs are computed against the
   previous *displayed* entry, so hiding an unused revision folds its change
   into the next used one. `usedCount`/`totalCount` feed the toggle labels.
4. **UI.** A two-button segmented control (`Used (n)` / `All (n)`) leads the
   filter row and is always shown; the kart/course selects follow when there
   is anything to filter. In *All*, cards a session ran get a `✓ Used` badge
   next to the Original/Revision tag (`HistoryCard`'s `header` slot — no chrome
   change). The empty state in *Used* points at *All* when edits exist.
5. **Vehicle history is unaffected** — it walks sessions, not revisions, so
   unused revisions never appear there.

## Touch points

- `src/lib/setupRevision.ts` — `findOrphanRevisionIds` takes revisions + live
  setup ids.
- `src/lib/setupRevisionStorage.ts` — `pruneSetupRevisions` reads `listSetups`.
- `src/hooks/useSetupManager.ts` — freeze after add/update.
- `src/lib/setupHistory.ts` — `SetupHistoryView`, `entry.used`, counts.
- `src/components/drawer/SetupHistoryPanel.tsx` — toggle + badge + empty hint.
- `src/locales/*/drawer.json` — `setupHistory.{viewLabel,viewUsed,viewAll,usedTag,emptyUsedHint}`.
- Tests: `setupRevision.test.ts`, `setupRevisionStorage.test.ts`,
  `setupHistory.test.ts`.

## Follow-ups

- The `SetupsTab` list still shows each setup's *would-be* hash; with a
  revision per save that now always equals the latest revision — a "restore
  this revision" action on a history card is the natural next step.
