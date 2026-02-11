

## Upgrade Braking G Calculation with Savitzky-Golay Filter

### Research Findings

Scientific literature on GPS-derived acceleration strongly recommends the **Savitzky-Golay (SG) filter** over simple finite-difference + EMA:

- **NREL GPS Data Filtration paper**: Recommends SG filter for "denoising and conditioning" GPS speed derivatives, noting it "reduces white noise while maintaining the overall profile"
- **ScienceDirect (IFAC 2019)**: Paper titled "Determining vehicle acceleration from noisy non-uniformly sampled speed data" explicitly extends SG filters for this exact use case
- **MDPI sports GNSS study**: Compared EMA, moving average, and 4th-order Butterworth -- all outperform raw differentiation; SG-class polynomial fitting is the cleanest for derivatives
- **FastF1 telemetry (TracingInsights)**: Real F1 analytics code uses `smooth_derivative()` with polynomial fitting for longitudinal acceleration

**Why SG is better than the current EMA approach:**
The current code differentiates first (noisy), then smooths with EMA (lags). SG fits a local polynomial to a window of speed samples and differentiates the polynomial analytically -- producing a smooth derivative in one step with no phase lag.

### Architecture

Two separate computation paths:

1. **Zone detection (map overlay)**: Keep the existing EMA-based state machine in `detectBrakingZones`. It works well for threshold-crossing detection and is already tuned with user-configurable settings.

2. **Graph channel (Braking G chart)**: Replace `computeBrakingGSeries` with a new SG-based function that produces much cleaner acceleration traces suitable for visual analysis.

### Changes

**1. Install `ml-savitzky-golay`**
- TypeScript npm package, ~2KB, zero dependencies
- Supports `derivative: 1` which gives us smooth acceleration directly from speed data

**2. `src/lib/brakingZones.ts`** -- Add SG-based graph series function

Add a new export `computeBrakingGSeriesSG(samples, windowSize)`:
- Extract the speed array (m/s) from samples
- Compute uniform time step `h` from median sample interval
- Call `savitzkyGolay(speedArray, h, { derivative: 1, windowSize, polynomial: 3 })` to get smooth dv/dt
- Divide by 9.81 to convert to G
- Apply the same speed gate (less than 2 m/s) and clamp to +/-3G
- Return the array

The existing `computeBrakingGSeries` (EMA-based) remains unchanged for zone detection.

**3. `src/components/graphview/GraphPanel.tsx`** -- Use new SG function for graph

Replace the `computeBrakingGSeries` call for the graph channel with `computeBrakingGSeriesSG`, using a configurable window size (default 25 for 25Hz data = 1 second window).

**4. `src/contexts/SettingsContext.tsx`** and `src/hooks/useSettings.ts`** -- Add graph smoothing window setting

Add `brakingGraphWindow: number` (default 25) to braking zone settings, exposed in the Settings modal.

**5. `src/components/SettingsModal.tsx`** -- Add "Graph Smoothing" slider

Under the Braking Zone Detection section, add a slider for "Graph Window" (range 5-51, odd numbers only) that controls the SG filter window size for the Braking G chart.

### Technical Details

The Savitzky-Golay filter with `derivative: 1` and `polynomial: 3` (cubic) computes smooth acceleration by:
1. For each sample, take a window of neighboring speed values
2. Fit a 3rd-degree polynomial via least squares
3. Evaluate the polynomial's first derivative at the center point
4. This gives acceleration with minimal noise and zero phase lag

Window size controls the trade-off:
- Smaller window (9-15): More responsive, shows brief braking events, slightly noisier
- Larger window (21-35): Very smooth trace, may slightly widen braking events
- Default 25 at 25Hz = 1-second window, matching common motorsport telemetry practice

