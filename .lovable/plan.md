

## Weather Panel Implementation

This plan adds a weather data panel to the lower-left of the map view, displaying temperature, humidity, and density altitude. The panel integrates with the existing overlay toggle system and includes GPS validation.

---

### Overview

**New files to create:**
- `src/lib/weatherService.ts` - API client for NWS station lookup + IEM weather data fetch
- `src/components/WeatherPanel.tsx` - UI component for the weather display

**Files to modify:**
- `src/components/RaceLineView.tsx` - Add WeatherPanel to the map view
- `src/pages/Index.tsx` - Pass session data (GPS point + start time) to RaceLineView

---

### Feature 1: Weather Panel UI

**New component: `src/components/WeatherPanel.tsx`**

Position: Bottom-left of map view (above zoom controls)

**Layout:**
```text
+-------------------------+
| Weather                 |
+-------------------------+
| Temp:      72 F (22 C)  |
| Humidity:  65%          |
| DA:        1,234 ft     |
+-------------------------+
```

**States:**
- Loading: Show skeleton/spinner while fetching
- Error: Show "Weather unavailable" message
- Success: Display formatted weather data
- No data: Hidden when session has no valid GPS or start date

**Styling:**
- Match existing panel style: `bg-card/90 backdrop-blur-sm border border-border rounded p-2`
- Follows `showOverlays` toggle visibility

---

### Feature 2: GPS Validation

**Validation function in `src/lib/weatherService.ts`:**
```typescript
function isValidGpsPoint(lat: number, lon: number): boolean {
  // Skip invalid coordinates (0,0 is common GPS error)
  if (lat === 0 || lon === 0) return false;
  // Bounds check
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return true;
}
```

This matches the validation pattern used in:
- `src/lib/nmeaParser.ts`
- `src/lib/ubxParser.ts`
- `src/lib/vboParser.ts`
- `src/lib/aimParser.ts`
- `src/lib/alfanoParser.ts`

**Usage:**
- Validate GPS point before making any API calls
- Return early with null if invalid
- WeatherPanel shows nothing when GPS is invalid

---

### Feature 3: Weather Data Service

**New file: `src/lib/weatherService.ts`**

**Types:**
```typescript
interface WeatherStation {
  stationId: string;    // e.g., "KOKC"
  name: string;         // e.g., "Oklahoma City"
  distanceKm: number;
}

interface WeatherData {
  station: WeatherStation;
  temperatureF: number;
  temperatureC: number;
  humidity: number;         // percentage
  altimeterInHg: number;    // for DA calculation
  densityAltitudeFt: number;
  observationTime: Date;
}
```

**API Flow:**
1. Validate GPS point using `isValidGpsPoint(lat, lon)`
2. If invalid, return null immediately
3. Call NWS API: `GET https://api.weather.gov/points/{lat},{lon}`
4. Get `observationStations` URL from response
5. Fetch station list, find nearest ASOS/AWOS station
6. Call IEM ASOS endpoint with station ID and session time range
7. Parse CSV response, calculate density altitude
8. Return `WeatherData` object

**Density Altitude Calculation:**
```text
Pressure Altitude (ft) = (29.92 - altimeter) x 1000 + field_elevation
Density Altitude (ft) = Pressure Altitude + (120 x (OAT_C - ISA_temp))
Where ISA_temp = 15 - (2 x altitude_in_thousands)
```

**Error Handling:**
- Invalid GPS: Return null silently
- Network failures: Return null, UI shows "unavailable"
- CORS issues: Graceful fallback message
- No nearby station: Show "No station found"

---

### Feature 4: Integration with RaceLineView

**New props for RaceLineView:**
```typescript
sessionGpsPoint?: { lat: number; lon: number };
sessionStartDate?: Date;
```

**Panel placement:**
- Position: `absolute bottom-16 left-4` (above zoom controls)
- Same z-index as other panels: `z-[1000]`
- Respects `showOverlays` toggle

**Data fetching:**
- Use `useEffect` to fetch weather once when session loads
- Cache result in component state
- Only fetch when valid GPS point and `sessionStartDate` are available

---

### Technical Implementation

**File: `src/lib/weatherService.ts` (NEW)**
- Export `isValidGpsPoint(lat, lon)` validation function
- Export `fetchNearestStation(lat, lon)` function
- Export `fetchWeatherData(stationId, date)` function
- Export `calculateDensityAltitude(tempC, altimeterInHg, fieldElevation)` utility
- Export types

**File: `src/components/WeatherPanel.tsx` (NEW)**
- Props: `lat`, `lon`, `sessionDate`, `visible`
- Internal state for weather data, loading, error
- Validate GPS before fetching
- Fetch on mount when props available and valid
- Display formatted data with units

**File: `src/components/RaceLineView.tsx`**
- Add new props: `sessionGpsPoint`, `sessionStartDate`
- Import and render `WeatherPanel` component
- Position in bottom-left, conditionally shown with `showOverlays`

**File: `src/pages/Index.tsx`**
- Find first valid GPS sample (skip 0,0 coordinates)
- Extract `startDate` from parsed data
- Pass to RaceLineView as new props

---

### Files Summary

| File | Changes |
|------|---------|
| `src/lib/weatherService.ts` | **New** - NWS + IEM API client, GPS validation, DA calculation |
| `src/components/WeatherPanel.tsx` | **New** - Weather display UI component |
| `src/components/RaceLineView.tsx` | Add WeatherPanel, new props |
| `src/pages/Index.tsx` | Extract valid GPS point and start date, pass to RaceLineView |

---

### GPS Point Extraction in Index.tsx

```typescript
// Find first valid GPS sample for weather lookup
const sessionGpsPoint = useMemo(() => {
  if (!data?.samples?.length) return undefined;
  const validSample = data.samples.find(s => 
    s.lat !== 0 && s.lon !== 0 && 
    Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180
  );
  return validSample ? { lat: validSample.lat, lon: validSample.lon } : undefined;
}, [data?.samples]);
```

This ensures we skip any invalid/placeholder GPS coordinates before attempting weather lookup.

