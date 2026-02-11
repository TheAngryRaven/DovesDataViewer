

## Fix the Overlay Toggle Button

### Problems Found

1. **Button always visible**: The Overlay toggle button renders in the tab bar regardless of which tab is active. It should only appear on the "Race Line" tab.

2. **State is disconnected**: The `TabBar` component manages `showOverlays` as internal state, but the actual `RaceLineTab` receives a hardcoded `showOverlays={true}` (line 393). Toggling the button does nothing.

### Fix

**Move `showOverlays` state up to the parent** (`DataView` or the main Index component) so it can be:
- Passed down to `RaceLineTab` as an actual prop
- Passed to `TabBar` so the button reflects the real state

**Conditionally render the button** only when `topPanelView === "raceline"`.

### Changes

**`src/pages/Index.tsx`**

1. In the parent component that renders `TabBar` and `RaceLineTab`, add `showOverlays` state:
   ```
   const [showOverlays, setShowOverlays] = useState(true);
   ```

2. Pass it to `TabBar`:
   ```
   <TabBar ... showOverlays={showOverlays} onToggleOverlays={() => setShowOverlays(v => !v)} />
   ```

3. Pass it to `RaceLineTab`:
   ```
   showOverlays={showOverlays}   // instead of hardcoded true
   ```

4. Update the `TabBar` component:
   - Remove its internal `showOverlays` state
   - Accept `showOverlays`, `onToggleOverlays`, and `topPanelView` as props
   - Only render the Overlay button when `topPanelView === "raceline"`

This is a small wiring fix -- no new files, no logic changes, just reconnecting the state properly.
