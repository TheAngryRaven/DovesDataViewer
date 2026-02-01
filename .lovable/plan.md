
- Root cause: a common flexbox issue—your chart area (`flex-1`) is missing `min-h-0`, so when the panel shrinks the canvas overflows instead of the container height decreasing; ResizeObserver then can’t “see” the true smaller height consistently.
- Fix: add `min-h-0` + `overflow-hidden` + `w-full` to the chart container, and ensure the TelemetryChart root is also `min-h-0` so height propagation works.
