/** Theme-aware color palettes for canvas-drawn charts */

export interface ChartColorPalette {
  background: string;
  grid: string;
  axisText: string;
  tooltipBg: string;
  tooltipBorder: string;
  scrubCursor: string;
  zeroLine: string;
  refLine: string;
  deltaText: string;
}

const dark: ChartColorPalette = {
  background: 'hsl(220, 18%, 10%)',
  grid: 'hsl(220, 15%, 20%)',
  axisText: 'hsl(220, 10%, 55%)',
  tooltipBg: 'hsla(220, 18%, 10%, 0.9)',
  tooltipBorder: 'hsl(220, 15%, 25%)',
  scrubCursor: 'hsl(0, 75%, 55%)',
  zeroLine: 'hsla(220, 10%, 55%, 0.4)',
  refLine: 'hsla(220, 10%, 55%, 0.5)',
  deltaText: 'hsl(0, 0%, 85%)',
};

const light: ChartColorPalette = {
  background: 'hsl(0, 0%, 100%)',
  grid: 'hsl(220, 15%, 88%)',
  axisText: 'hsl(220, 10%, 40%)',
  tooltipBg: 'hsla(0, 0%, 100%, 0.95)',
  tooltipBorder: 'hsl(220, 15%, 80%)',
  scrubCursor: 'hsl(0, 75%, 50%)',
  zeroLine: 'hsla(220, 10%, 50%, 0.4)',
  refLine: 'hsla(220, 10%, 45%, 0.5)',
  deltaText: 'hsl(220, 10%, 30%)',
};

export function getChartColors(isDark: boolean): ChartColorPalette {
  return isDark ? dark : light;
}
