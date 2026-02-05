

## Wind in MPH, Direction Arrow, and Session METAR Detail Button

### 1. Convert wind speed from knots to MPH in the METAR dialog

In `LocalWeatherDialog.tsx`, convert `windSpeedKts` and `windGustKts` to MPH (multiply by 1.15078) for display. Update the wind value string to show MPH instead of kts.

### 2. Add a wind direction arrow icon

In the Wind `WeatherItem` inside `LocalWeatherDialog.tsx`, add a small inline SVG arrow (or use a Lucide `Navigation` icon) rotated by the `windDirectionDeg` value. The arrow points in the direction the wind is coming FROM, with up = North (0 degrees). This sits next to the wind text value inside the weather item.

### 3. Add a "Session METAR Detail" button in the map view

In `RaceLineView.tsx`, add a second button to the LEFT of the existing weather toggle button (bottom-right area). When clicked, it opens the `LocalWeatherDialog` in a **session mode** -- no search bar, no GPS button, just immediately shows the session's weather data.

To support this:
- Refactor `LocalWeatherDialog` to accept optional props:
  - `sessionWeather?: WeatherData` -- if provided, skip search UI entirely and render the weather data directly
  - `externalOpen? / onExternalOpenChange?` -- allow the dialog to be controlled externally (opened by the map button)
- The map button only appears when weather data is available (when `showWeather` is true and the WeatherPanel has data)

### Technical details

**Files to edit:**

| File | Changes |
|------|---------|
| `src/components/LocalWeatherDialog.tsx` | (a) Convert kts to MPH for display. (b) Add rotated arrow icon next to wind value. (c) Accept optional `sessionWeather` prop to render in read-only mode (no search UI). (d) Accept `open`/`onOpenChange` props for external control. |
| `src/components/RaceLineView.tsx` | Add state for session METAR dialog open. Add a second button (left of CloudSun toggle). Pass session weather data to the dialog. Need to lift `weather` from WeatherPanel or track it via a callback. |
| `src/components/WeatherPanel.tsx` | Add `onWeatherLoaded?: (data: WeatherData) => void` callback so the parent can capture the resolved weather data for the detail dialog. |

**Wind display format change:**
- Current: `270deg @ 8 kts G15`
- New: `270deg @ 9 mph G17` (with a small arrow rotated to 270deg)

**Arrow approach:** Use the Lucide `Navigation` icon with inline `style={{ transform: rotate(Xdeg) }}` where X = windDirectionDeg. The Navigation icon points up by default (north), which is perfect.

