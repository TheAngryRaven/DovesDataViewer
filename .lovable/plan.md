

# Add Video Tab to Graph View InfoBox

## Overview
Add a third "Video" tab to the InfoBox in the Graph View sidebar, to the right of "Kart". This embeds the existing VideoPlayer component directly inside the sidebar panel, synced to the same telemetry cursor as the graph charts.

## What Changes

### 1. `src/components/graphview/GraphViewPanel.tsx` -- Pass video props through
- Add video-related props to `GraphViewPanelProps`: `videoState`, `videoActions`, `onVideoLoadedMetadata`, `currentSample`
- Forward these to InfoBox

### 2. `src/components/graphview/InfoBox.tsx` -- Add "Video" tab
- Add `'video'` to the `InfoTab` type union
- Add a third tab button labeled "Video" in the tab bar
- In the video tab content, render `<VideoPlayer>` with the passed props
- The video player already handles its own "no video loaded" state with a load button, so no extra empty-state logic needed

### 3. `src/components/tabs/GraphViewTab.tsx` -- Pass video props through
- Extend the props it receives to include video sync data and forward to `GraphViewPanel`

### 4. `src/pages/Index.tsx` -- Wire video sync into GraphViewTab
- Pass `videoSync.state`, `videoSync.actions`, `videoSync.handleLoadedMetadata`, and `currentSample` to the `GraphViewTab` component

## Technical Details

The VideoPlayer component is already fully self-contained and modular -- it manages its own toolbar, overlays, auto-hide, and settings dialog. The same `useVideoSync` hook instance from Index.tsx is shared between Labs and Graph View, so both tabs show the same video with the same sync offset. Since `useVideoSync` receives `visibleSamples` and `currentIndex` from the parent, and the Graph View already provides scrubbing via `onScrub`, the video will automatically sync to the Graph View's telemetry cursor.

### Props pipeline

```text
Index.tsx (useVideoSync hook)
  -> GraphViewTab (pass-through)
    -> GraphViewPanel (pass-through)
      -> InfoBox (renders VideoPlayer in "Video" tab)
```

### Files modified (4 total)
1. `src/pages/Index.tsx` -- Add 4 video props to GraphViewTab
2. `src/components/tabs/GraphViewTab.tsx` -- Forward new props
3. `src/components/graphview/GraphViewPanel.tsx` -- Add video props to interface, forward to InfoBox
4. `src/components/graphview/InfoBox.tsx` -- Add "Video" tab with VideoPlayer
