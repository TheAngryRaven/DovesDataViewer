

## Visual Course Editor: Add New Lines & Location Search

This plan extends the Visual Course Editor to support creating new lines when they don't exist, and adds a location search bar for new track creation.

---

### Overview

Two new capabilities:

1. **Create lines at map center**: When a user clicks a line button (Start/Finish, Sector 2, or Sector 3) and no coordinates exist for that line, create a new ~30-meter line at the center of the current map view

2. **Location search for new tracks**: When creating a new track in Visual mode, show a search bar above the toolbar that allows users to search for an address/location and pan the map there

---

### Feature 1: Create Lines at Map Center

**Current behavior**: When clicking a line button with no existing coordinates, `getLineCoords()` returns `null` and the helper text shows "No line defined" - nothing else happens.

**New behavior**: When clicking a line button with no existing coordinates:
1. Get the current map center using `map.getCenter()`
2. Calculate two points ~30 meters apart (one ~15m to the left, one ~15m to the right of center)
3. Set these as pending coordinates
4. Create the draggable markers and polyline
5. User can now drag to position, then click "Done" to commit

**Implementation details**:

```text
Distance calculation:
- At most latitudes, ~0.00015 degrees longitude ≈ ~15 meters
- Create Point A at (center.lat, center.lng - 0.00015)
- Create Point B at (center.lat, center.lng + 0.00015)
- This gives a horizontal line ~30m wide
```

**Changes to `handleToolChange` in `VisualEditor`**:
- After checking `getLineCoords(tool)`, if it returns `null`:
  - Get map center
  - Calculate the two endpoints
  - Set the appropriate pending state (pendingStartFinish, pendingSector2, or pendingSector3)
  - Create editing layers with these new coordinates

**Changes to `handleDone`**:
- Currently only commits if there are pending changes AND a callback exists
- Now also needs to handle the case where pending data was created from scratch (new line)

---

### Feature 2: Location Search for New Tracks

**When to show**: Only in the "Add New Track" dialog when Visual mode is selected

**UI placement**: A search input row above the `VisualEditorToolbar`, inside the `VisualEditor` component when `isNewTrack` prop is true

**Search implementation**:
- Use OpenStreetMap Nominatim API (free, no API key required)
- Endpoint: `https://nominatim.openstreetmap.org/search?format=json&q={query}`
- On search submit, fetch results and pan map to first result's coordinates
- Simple text input with a search button or Enter key submission

**Props addition to VisualEditor**:
- `isNewTrack?: boolean` - when true, shows the location search bar

**Search bar component**:
```text
[  Search location...      ] [🔍]
```

- Input field with placeholder "Search location..."
- Search icon button to trigger search
- On submit: fetch from Nominatim, get first result, `map.setView([lat, lon], 17)`
- Shows brief loading state
- Error handling: toast or inline message if no results found

---

### Technical Approach

**File to modify:** `src/components/TrackEditor.tsx`

**Changes to VisualEditor component**:

1. Add new prop `isNewTrack?: boolean`

2. Add state for search:
   - `searchQuery: string`
   - `isSearching: boolean`

3. Add `createLineAtMapCenter(tool: VisualEditorTool)` function:
   - Gets current map center
   - Calculates ~30m line (horizontal orientation)
   - Sets pending state for the appropriate line type
   - Returns the new coordinates for layer creation

4. Update `handleToolChange`:
   - If `getLineCoords(tool)` returns null and map exists:
     - Call `createLineAtMapCenter(tool)`
     - Use returned coordinates for `fitBounds` and `createEditingLayers`

5. Add location search function:
   - `handleLocationSearch(query: string)`: async function that:
     - Fetches from Nominatim API
     - Pans map to result location
     - Uses `map.setView()` at zoom 17-18

6. Conditionally render search bar above toolbar when `isNewTrack` is true

**Parent component changes**:

1. Pass `isNewTrack={true}` to VisualEditor in the "Add New Track" dialog
2. Pass `isNewTrack={false}` (or omit) for Edit Course and Add Course dialogs

---

### User Flow: Creating a New Line

```text
1. User opens Edit Course in Visual mode
2. Sector 2 has no coordinates defined
3. User clicks "Sector 2" button
   -> Map stays at current position
   -> A new 30m line appears at map center
   -> Two draggable markers are created
4. User drags markers to desired position
5. User clicks "Done"
   -> Coordinates saved to form state
6. User clicks "Update" to persist
```

---

### User Flow: New Track with Location Search

```text
1. User clicks + to add new track
2. User switches to Visual mode
3. Search bar appears above toolbar
4. User types "Orlando Kart Center" and presses Enter
   -> Map pans to that location (zoom 17)
5. User clicks "Start/Finish" button
   -> 30m line appears at map center
6. User positions the line
7. User fills in track/course names and saves
```

---

### Edge Cases

- **Nominatim rate limits**: Add a small debounce, and User-Agent header as per Nominatim usage policy
- **No search results**: Show message "Location not found, try a different search"
- **Map not yet initialized**: Search button disabled until map is ready
- **Creating multiple lines**: Each line button click creates a new line at the current map center if none exists

