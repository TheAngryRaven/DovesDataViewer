

## Visual Editor Interactive Line Editing

This plan adds interactive draggable point editing to the Visual Editor in the Track Editor, starting with the Edit Course flow.

---

### Overview

When editing a course in Visual mode, users will be able to:
1. Click a tool button (Start/Finish, Sector 2, or Sector 3) to enter edit mode for that line
2. See the map center on the selected line
3. Drag the two endpoint markers to reposition the line
4. Click "Done" to confirm changes (updates the form state)
5. Click "Update" to save to storage (existing behavior)

---

### Implementation Details

#### 1. Add Draggable Markers to VisualEditor

When a tool is selected, create two draggable Leaflet markers (Point A and Point B) for the active line:

- **Markers will be styled distinctly** - using circle markers or custom icons to make them visible on satellite imagery
- **Markers are draggable** - using `L.marker(..., { draggable: true })`
- **On drag, line updates in real-time** - the polyline between the two markers updates as you drag
- **Camera does NOT follow** - no automatic panning when dragging

#### 2. Center Map When Tool Selected

When `handleToolChange` is called with a tool:
- Calculate the center point of the selected line (average of A and B coordinates)
- Use `map.setView(center, zoom, { animate: true })` to smoothly pan to the line
- Keep current zoom level or adjust slightly to ensure line is visible

#### 3. Track Pending Coordinate Changes

Add local state to `VisualEditor` to track modified coordinates while editing:

```
pendingStartFinish: { a: GpsPoint, b: GpsPoint } | null
pendingSector2: SectorLine | null
pendingSector3: SectorLine | null
```

These hold the "working" coordinates while dragging. The original props remain unchanged until "Done" is clicked.

#### 4. Callback Flow for "Done" Button

When the user clicks "Done":
1. Call the appropriate `onStartFinishChange`, `onSector2Change`, or `onSector3Change` callback with the new coordinates
2. These callbacks will update the form state (formLatA, formLonA, etc.)
3. The "Update" button (already in the parent) saves to storage

#### 5. Visual Feedback

- **Active line highlighted** - the line being edited should have a different color or style
- **Inactive lines dimmed** - other lines remain visible but less prominent
- **Markers only shown for active line** - reduces clutter
- **Helper text** - shows which line is being edited

---

### Technical Approach

**File to modify:** `src/components/TrackEditor.tsx`

**Changes to VisualEditor component:**

1. Add state for pending coordinates and marker/line layer references
2. Create/update markers and polyline when `activeTool` changes
3. Attach `dragend` event handlers to markers that update pending state and redraw the line
4. Use `L.circleMarker` for better visibility on satellite (bright colored circles)
5. Center map on the selected line when a tool is activated
6. On "Done", propagate changes via callbacks and clear active tool
7. Disable map dragging during marker drag to prevent accidental panning

**Marker drag handling:**
- Use Leaflet's `dragend` event on markers
- Get new position with `marker.getLatLng()`
- Update the polyline coordinates
- Store in pending state

**No camera movement during drag:**
- The map naturally won't move when dragging a marker unless we explicitly tell it to
- Leaflet handles this correctly by default

---

### User Flow Summary

```text
1. User opens Edit Course dialog
2. User switches to Visual mode
3. User clicks "Start/Finish" button
   -> Map centers on the Start/Finish line
   -> Two draggable markers appear at Point A and Point B
   -> Line is highlighted
4. User drags a marker
   -> Line updates in real-time
   -> Map stays still
5. User clicks "Done"
   -> Coordinates are written to form state
   -> Markers are removed
   -> "Start/Finish" button deselects
6. User can edit another line or click "Update" to save
```

---

### Edge Cases Handled

- **No existing coordinates**: If a line doesn't exist yet (null), markers won't be shown and the user will see appropriate messaging
- **Switching tools**: When switching from one tool to another, pending changes for the previous tool are discarded unless "Done" was clicked
- **Cancel/Close dialog**: Pending visual changes are discarded (form state unchanged)

