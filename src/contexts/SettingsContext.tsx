import { createContext, useContext } from 'react';

export interface BrakingZoneSettings {
  entryThresholdG: number;
  exitThresholdG: number;
  minDurationMs: number;
  smoothingAlpha: number;
  color: string;
  width: number;
  graphWindow: number;
  brakeMaxG: number; // G value that maps to 100%
}

export interface SettingsContextValue {
  useKph: boolean;
  useMetricDistance: boolean;
  useMetricWeather: boolean;
  gForceSmoothing: boolean;
  gForceSmoothingStrength: number;
  brakingZoneSettings: BrakingZoneSettings;
  enableLabs: boolean;
  darkMode: boolean;
  gForceSource: 'gps' | 'hw';
  chartXAxis: 'time' | 'distance';
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children, value }: { children: React.ReactNode; value: SettingsContextValue }) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- useSettingsContext hook is conventionally co-located with SettingsProvider
export function useSettingsContext(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettingsContext must be used within SettingsProvider');
  return ctx;
}

// Non-throwing variant for surfaces that may render outside the provider (e.g.
// the Profile drawer tab on the landing page). Returns null when unmounted.
// eslint-disable-next-line react-refresh/only-export-components -- co-located with SettingsProvider
export function useOptionalSettingsContext(): SettingsContextValue | null {
  return useContext(SettingsContext);
}
