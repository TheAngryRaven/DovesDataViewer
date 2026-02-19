

# Fix Video Sync Persistence Race Condition

## Problem
When the user refreshes the page and reloads a video, the saved sync offset is lost. The root cause is a race condition in `loadVideo`:

1. Hook initializes with `syncOffsetMs = 0`
2. Restore effect fires asynchronously (IndexedDB read)
3. User clicks "Load Video" -- `loadVideo` captures `syncOffsetMs` from its closure
4. `persistSync(syncOffsetMs, handle, file.name)` is called at line 140/163, which **overwrites** the IndexedDB record
5. If the restore hasn't completed or the callback hasn't been re-created yet, it writes `0` as the offset -- destroying the saved value

## Solution
Use a ref (`syncOffsetMsRef`) alongside the state so that `loadVideo` always reads the latest restored value, regardless of closure timing. This avoids the stale-closure problem entirely.

## Changes

### `src/hooks/useVideoSync.ts`

1. Add a `syncOffsetMsRef` that mirrors `syncOffsetMs` state:
   - Initialize: `const syncOffsetMsRef = useRef(0)`
   - Keep in sync: whenever `setSyncOffsetMs` is called, also update the ref

2. In `loadVideo`, replace `persistSync(syncOffsetMs, ...)` with `persistSync(syncOffsetMsRef.current, ...)` on both paths (File System Access API at ~line 140 and fallback input at ~line 163). This ensures the persisted offset is always the latest restored value, not a stale closure capture.

3. Remove `syncOffsetMs` from `loadVideo`'s dependency array since it now reads from the ref instead.

This is a minimal, surgical fix -- no behavior changes, just eliminating the stale-closure race.
