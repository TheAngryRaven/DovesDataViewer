
# Smooth Draggable Overlay Rewrite

## Problem
The overlay dragging is jerky because every pointer move triggers `actions.updateOverlaySettings`, which updates React state, persists to IndexedDB, and causes a full re-render cycle. The element also uses `left`/`top` CSS positioning which doesn't benefit from GPU compositing.

## Solution
Rewrite `DraggableOverlay` to use **local state during drag** and only commit to the parent on pointer up. Use CSS `transform: translate()` for GPU-accelerated, sub-pixel smooth movement.

## Changes (1 file)

### `src/components/VideoPlayer.tsx`

**DraggableOverlay rewrite:**
- Add a local `localPos` state initialized from the `position` prop
- Sync `localPos` from prop when not dragging (so external changes are reflected)
- During drag: update only `localPos` via `setState` -- no calls to `onMove` until pointer up
- On pointer up: call `onMove(id, localPos)` once to persist
- Switch from `style={{ left, top }}` to `style={{ transform: translate(x%, y%) }}` with `will-change: transform` for GPU compositing
- Add `touch-action: none` to prevent scroll interference on mobile

**No other files change** -- the `DraggableOverlay` component is already self-contained and the parent interface (`onMove` callback) stays the same. The only difference is `onMove` fires once on drop instead of on every pixel, which is actually better for persistence.

## Technical Detail

```text
Before (every frame):
  pointerMove -> onMove(pos) -> updateOverlaySettings(pos) -> setState -> persist to IDB -> re-render

After (only on drop):
  pointerMove -> setLocalPos(pos)  [local state, fast re-render of just the overlay]
  pointerUp   -> onMove(pos) -> updateOverlaySettings(pos) -> persist to IDB
```

This reduces IndexedDB writes from ~60/sec during drag to exactly 1, and keeps React re-renders scoped to the overlay component only.
