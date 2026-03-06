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
  gForceSmoothing: boolean;
  gForceSmoothingStrength: number;
  brakingZoneSettings: BrakingZoneSettings;
  enableLabs: boolean;
  darkMode: boolean;
  gForceSource: 'gps' | 'hw';
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children, value }: { children: React.ReactNode; value: SettingsContextValue }) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettingsContext(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettingsContext must be used within SettingsProvider');
  return ctx;
}
