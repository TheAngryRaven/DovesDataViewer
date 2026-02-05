

## Cache Weather Station Lookups in IndexedDB

Save the nearest weather station result (stationId, name, distanceKm) per file in the existing metadata store, so reloading a saved file skips the two NWS API calls (points + stations) and goes straight to fetching weather observations from IEM ASOS.

---

### What gets cached

Only the `WeatherStation` object (`stationId`, `name`, `distanceKm`) -- not the weather data itself. This saves 2 network requests per file reload (the NWS points lookup and the stations list lookup).

---

### Changes

#### 1. `src/lib/fileStorage.ts` -- Extend FileMetadata

Add optional weather station fields to the existing `FileMetadata` interface:

```typescript
export interface FileMetadata {
  fileName: string;
  trackName: string;
  courseName: string;
  // Cached weather station lookup
  weatherStationId?: string;
  weatherStationName?: string;
  weatherStationDistanceKm?: number;
}
```

No DB version bump needed -- these are just new optional properties on the same object store records.

#### 2. `src/lib/weatherService.ts` -- Accept optional cached station

Modify `fetchSessionWeather` to accept an optional `cachedStation` parameter. If provided, skip the NWS lookup entirely and go straight to `fetchWeatherData`:

```typescript
export async function fetchSessionWeather(
  lat: number,
  lon: number,
  sessionDate: Date,
  cachedStation?: WeatherStation | null
): Promise<WeatherData | null> {
  if (!isValidGpsPoint(lat, lon)) return null;

  const station = cachedStation ?? await fetchNearestStation(lat, lon);
  if (!station) return null;

  return fetchWeatherData(station, sessionDate);
}
```

#### 3. `src/components/WeatherPanel.tsx` -- Pass cached station, emit found station

Add two new optional props:

- `cachedStation?: WeatherStation | null` -- if present, skip the GPS lookup
- `onStationResolved?: (station: WeatherStation) => void` -- called after a successful station lookup so the parent can persist it

Update the `useEffect` to:
1. If `cachedStation` is provided, call `fetchWeatherData(cachedStation, sessionDate)` directly
2. If not, call `fetchSessionWeather(lat, lon, sessionDate)` as before, then invoke `onStationResolved` with the station from the result

#### 4. `src/components/RaceLineView.tsx` -- Thread new props

Pass `cachedStation` and `onStationResolved` through to `WeatherPanel`. These come from the parent (`Index.tsx`).

Add two new props to RaceLineView:
- `cachedWeatherStation?: WeatherStation | null`
- `onWeatherStationResolved?: (station: WeatherStation) => void`

#### 5. `src/pages/Index.tsx` -- Persist and restore station

- When a file is loaded from the file manager and metadata exists with `weatherStationId`, construct a `WeatherStation` object and pass it down as `cachedWeatherStation`
- Add a handler `handleWeatherStationResolved` that saves the station fields to the file's metadata in IndexedDB (merge with existing track/course metadata using `saveFileMetadata`)
- Pass both props through to `RaceLineView`

---

### Flow

**First load of a file:**
1. WeatherPanel calls NWS points API + stations API (2 requests)
2. Gets station, fetches weather from IEM ASOS (1 request)
3. Calls `onStationResolved(station)` 
4. Index.tsx saves station to FileMetadata in IndexedDB

**Subsequent loads of the same file:**
1. Index.tsx reads FileMetadata, finds cached station
2. Passes `cachedStation` to WeatherPanel
3. WeatherPanel skips NWS lookup, goes straight to IEM ASOS (1 request instead of 3)

---

### Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/fileStorage.ts` | Edit | Add optional station fields to FileMetadata |
| `src/lib/weatherService.ts` | Edit | Accept optional cachedStation in fetchSessionWeather |
| `src/components/WeatherPanel.tsx` | Edit | Add cachedStation + onStationResolved props |
| `src/components/RaceLineView.tsx` | Edit | Thread new props to WeatherPanel |
| `src/pages/Index.tsx` | Edit | Persist station on resolve, restore on file load |

