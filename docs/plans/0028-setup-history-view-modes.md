# Setup history view modes — scrub a track day's edits, Used / All toggle

> Status: **LANDED.** Builds on the setup-revision model documented in
> `docs/subsystems.md` → *Setup Revisions*.

## Problem

Opening a setup's history (SetupsTab → book icon) only ever showed the states
that had been assigned to a session. That was a direct consequence of two
earlier decisions: a `SetupRevision` was frozen **only** on session assignment
(`useSessionMetadata.handleSaveSessionSetup`), and the orphan prune swept any
revision no session referenced. So plain edits — the "+1 toe at 10am, backed
out at 2pm" story of a hectic track day, where nobody remembers to tag the
session — left no trace at all.

The maintainer's ask, refined over two rounds: a general history with a
**Used / All** toggle (used revisions marked in *All*), **but** bounded —
every save forever would be a lot of data. Keep the sweeper and lean on it:
show the last three days of untagged changes with a notice that says so.

## Approach & key decisions

1. **Freeze on every save.** `useSetupManager.addSetup`/`updateSetup` call
   `freezeSetupRevision` right after `saveSetup`. The hook is the only writer
   of setups from the UI; the cloud-sync accessor writes pulled setups
   directly, so a pull never re-freezes. Content addressing makes an
   unchanged save a no-op — except that a dedup re-freeze now **bumps
   `updatedAt`** (last save of that content) so "saved again today" reads as
   fresh to the sweep. *Rejected:* freezing inside `saveSetup` itself —
   `setupRevisionStorage` imports `setupStorage` (a cycle), and it would make
   sync pulls freeze too.
2. **Retention sweep, not a keep-forever rule** (`findPrunableRevisionIds`).
   A revision survives when any of: a session references it; it was saved
   less than `REVISION_RETENTION_MS` (3 days) ago; it is the newest
   unreferenced revision of a still-existing setup. The last exception is
   the maintainer's explicit choice — the *newest unreferenced* one, even when
   a newer session-tied revision sits above it — so the last untagged state
   is always scrubbable. A deleted setup's untagged revisions all age out.
   *Rejected (round 1):* keeping every unreferenced revision of a live setup
   forever — the data-volume concern that triggered the rework.
3. **No throttle.** The old once-per-3-days localStorage throttle meant a
   revision could outlive the notice by days. The sweep is three IndexedDB
   reads, so it now runs on garage mount (`useSetupManager`) and every time
   the history panel opens (`SetupHistoryPanel` sweeps before listing), so the
   panel always matches what the notice promises.
4. **Untagged revisions never reach the cloud.** The prune is local-only and
   tombstones rather than deletes the cloud copy, and `reconcileDocs` pushes
   every local document missing from the cloud — so without a gate, edit
   revisions would pile up in the cloud forever. New `StoreAccessor.pushFilter`
   seam (built once per pass): the setup-revisions accessor admits only ids
   some local `FileMetadata.sessionSetupRev` references. Both `pushRecord`
   (returns whether it uploaded) and the reconcile push loop honour it; pulls
   are untouched. Assigning a setup emits the revision `put` **after** the
   metadata write so the gate sees the reference; a dedup freeze at assignment
   time no longer needs to emit itself. The tombstone is cleared only on an
   actual upload. *Rejected:* pushing everything and deleting the cloud copy
   on prune (a session on another device that hasn't synced yet could lose
   its revision), and pushing everything with local-only prune (unbounded
   cloud growth).
5. **View mode in the pure model.** `SetupHistoryFilter.view: "used" | "all"`
   (default `used`, which matches what users saw before). `buildSetupHistory`
   aggregates every revision, marks `entry.used = usages.length > 0` **after**
   the kart/course filter, then keeps only the used ones in the `used` view,
   so the *Used* list and the *All* badges always agree. Diffs are against
   the previous *displayed* entry. `usedCount`/`totalCount` feed the toggle.
6. **UI.** Cards render newest on top with the original at the bottom (the
   model stays oldest-first; the panel reverses, and "original" is the entry
   with no diff). A two-button segmented control (`Used (n)` / `All (n)`) leads the
   filter row; in *All*, a one-line notice under it states the retention rule
   (interpolating `REVISION_RETENTION_MS` in days) and used cards get a
   `✓ Used` badge via `HistoryCard`'s `header` slot. The empty state in *Used*
   points at *All* when untagged edits exist.
7. **Vehicle history is unaffected** — it walks sessions, not revisions.

### Round three — rollback + duplicate (landed)

The maintainer's follow-up: once the newest revision is untagged scratch,
offer a way back. Anchoring both actions to **session-linked revisions only**
is what keeps this simple — those revisions are permanent (never swept) and
already in the cloud, so the target can neither vanish mid-tap nor be missing
on another device. Untagged revisions get no buttons.

8. **Rollback** — one target only: `SetupHistory.latestReferencedId`, the
   revision that most recently *ran* (by session start, then capture time),
   ignoring the kart/course filters. The button shows only when the live
   setup's current hash (SetupsTab already computes it; now the full hash,
   shortened at display) differs from that revision. Confirm dialog, then
   `restoreSetupFromRevision(live, revision)` → `onUpdate` → the ordinary save
   freezes and dedups back onto the old hash. Identity is kept (id, vehicle,
   **name**, createdAt): a later rename is not a setup change, so if the name
   differs the result is a new hash rather than a byte-identical revert. The
   scratch edits remain the newest untagged revision and survive the sweep,
   so a rollback is itself undoable by hand for three days. *Rejected:* making
   cards tappable with a popup — only one card can ever be a target, so an
   explicit button reads better; and allowing any used revision — same
   safety properties, so a one-line relaxation later, but newest-only for v1.
9. **Duplicate** — on every referenced card: `duplicateSetupFromRevision` →
   `onAdd` with the name `"<name> (copy)"`, on the revision's vehicle. A copy
   of the same content on the *same* setup is impossible (content addressing
   dedups it), so "a new, unlinked revision with a copy" necessarily means a
   new setup whose original revision is that content.
10. `HistoryCard` gained an `actions` slot; the panel reloads after either
    action and toasts the result. `SetupsTab` re-derives the live setup from
    the list while the panel is open so the rollback's save shows at once.

## Touch points

- `src/lib/setupRevision.ts` — `REVISION_RETENTION_MS`, `findPrunableRevisionIds`
  (replaces `findOrphanRevisionIds` / `shouldPrune` / `PRUNE_INTERVAL_MS`);
  `restoreSetupFromRevision`, `duplicateSetupFromRevision`.
- `src/lib/setupRevisionStorage.ts` — `freezeSetupRevision(setupId, now)` bumps
  `updatedAt` on dedup; `referencedSetupRevisionIds`; `pruneSetupRevisions(now)`;
  `pruneSetupRevisionsSafely` (replaces `maybePruneSetupRevisions`).
- `src/hooks/useSetupManager.ts` — freeze after add/update; sweep on mount.
- `src/hooks/useSessionMetadata.ts` — emit the revision `put` after metadata.
- `src/plugins/cloud-sync/storeAccessors.ts` — `pushFilter` seam + gate;
  `syncEngine.ts` — `pushRecord` returns boolean, reconcile honours the gate;
  `autoSync.ts` — clear tombstone only on upload.
- `src/lib/setupHistory.ts` — `SetupHistoryView`, `entry.used`, `entry.referenced`,
  counts, `latestReferencedId`.
- `src/components/drawer/SetupHistoryPanel.tsx` — sweep on open, toggle,
  notice, badge, empty hint, Roll back / Duplicate buttons + confirm dialog;
  `HistoryCard.tsx` `actions` slot; `SetupsTab.tsx` wires both via
  `onUpdate` / `onAdd` and passes the live setup's full hash.
- `src/locales/*/drawer.json` — `setupHistory.{viewLabel,viewUsed,viewAll,usedTag,emptyUsedHint,retentionNotice}`.
- Tests: `setupRevision.test.ts`, `setupRevisionStorage.test.ts`,
  `setupHistory.test.ts`, cloud-sync `syncEngine.test.ts`, `storeAccessors.test.ts`.

## Follow-ups

- Setups that existed before this change have no revisions until their next
  save or assignment; no migration was judged worth it.
- Rollback to any used revision (not just the last-run one) is a one-line
  relaxation of `latestReferencedId` if it turns out to be wanted.
