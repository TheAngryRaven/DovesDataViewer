import { useState, useMemo, useCallback, useEffect } from 'react';
import { Pencil, Cloud, Thermometer, Droplets, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GpsSample, Course } from '@/types/racing';
import { findSpeedEvents } from '@/lib/speedEvents';
import { formatLapTime } from '@/lib/lapCalculation';
import { Kart } from '@/lib/kartStorage';
import { KartSetup } from '@/lib/setupStorage';
import { WeatherPanel } from '@/components/WeatherPanel';
import { WeatherStation } from '@/lib/weatherService';
import { useSettingsContext } from '@/contexts/SettingsContext';

interface InfoBoxProps {
  // Stats data
  filteredSamples: GpsSample[];
  course: Course | null;
  lapTimeMs: number | null;
  paceDiff: number | null;
  paceDiffLabel: 'best' | 'ref';
  deltaTopSpeed: number | null;
  deltaMinSpeed: number | null;
  referenceLapNumber: number | null;
  lapToFastestDelta: number | null;
  // Weather
  sessionGpsPoint?: { lat: number; lon: number };
  sessionStartDate?: Date;
  cachedWeatherStation: WeatherStation | null;
  onWeatherStationResolved: (station: WeatherStation) => void;
  // Kart/setup
  karts: Kart[];
  setups: KartSetup[];
  sessionKartId: string | null;
  sessionSetupId: string | null;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
  onOpenSetupEditor?: (setupId: string) => void;
}

type InfoTab = 'data' | 'kart';

export function InfoBox({
  filteredSamples, course, lapTimeMs, paceDiff, paceDiffLabel,
  deltaTopSpeed, deltaMinSpeed, referenceLapNumber, lapToFastestDelta,
  sessionGpsPoint, sessionStartDate, cachedWeatherStation, onWeatherStationResolved,
  karts, setups, sessionKartId, sessionSetupId, onSaveSessionSetup, onOpenSetupEditor,
}: InfoBoxProps) {
  const { useKph } = useSettingsContext();
  const [tab, setTab] = useState<InfoTab>('data');
  const [selectedKartId, setSelectedKartId] = useState<string | null>(sessionKartId);
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(sessionSetupId);

  useEffect(() => { setSelectedKartId(sessionKartId); setSelectedSetupId(sessionSetupId); }, [sessionKartId, sessionSetupId]);

  const unit = useKph ? 'kph' : 'mph';
  const convertSpeed = (speed: number) => useKph ? speed * 1.60934 : speed;

  // Speed events for stats
  const speedEvents = useMemo(() => {
    if (filteredSamples.length < 10) return [];
    return findSpeedEvents(filteredSamples, { smoothingWindow: 5, minSwing: 3, minSeparationMs: 1000, debounceCount: 2 });
  }, [filteredSamples]);

  const peaks = speedEvents.filter(e => e.type === 'peak');
  const valleys = speedEvents.filter(e => e.type === 'valley');
  const avgTop = peaks.length > 0 ? peaks.reduce((s, e) => s + e.speed, 0) / peaks.length : null;
  const avgMin = valleys.length > 0 ? valleys.reduce((s, e) => s + e.speed, 0) / valleys.length : null;

  // Kart/setup selection
  const filteredSetups = useMemo(() => {
    if (!selectedKartId) return [];
    return setups.filter(s => s.kartId === selectedKartId);
  }, [setups, selectedKartId]);

  const selectedKart = karts.find(k => k.id === sessionKartId);
  const selectedSetup = setups.find(s => s.id === sessionSetupId);
  const isSaved = selectedKartId === sessionKartId && selectedSetupId === sessionSetupId;

  const handleKartChange = useCallback((v: string) => {
    const id = v === 'none' ? null : v;
    setSelectedKartId(id);
    setSelectedSetupId(null);
  }, []);

  const handleSetupChange = useCallback((v: string) => {
    setSelectedSetupId(v === 'none' ? null : v);
  }, []);

  const handleSave = useCallback(async () => {
    await onSaveSessionSetup(selectedKartId, selectedSetupId);
  }, [selectedKartId, selectedSetupId, onSaveSessionSetup]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-card border-b border-border">
      {/* Tabs */}
      <div className="flex shrink-0 border-b border-border">
        <button
          onClick={() => setTab('data')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'data' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Data
        </button>
        <button
          onClick={() => setTab('kart')}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'kart' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Kart
        </button>
      </div>

      {/* Content - scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {tab === 'data' ? (
          <>
            {/* Lap time */}
            {lapTimeMs !== null && (
              <div className="flex justify-between text-xs pb-2 border-b border-border">
                <span className="text-muted-foreground">Lap Time</span>
                <span className="font-mono text-foreground font-semibold">{formatLapTime(lapTimeMs)}</span>
              </div>
            )}

            {/* Avg speeds */}
            {course && speedEvents.length > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Avg Top Speed</span>
                  <span className="font-mono" style={{ color: 'hsl(142, 76%, 45%)' }}>
                    {avgTop !== null ? `${convertSpeed(avgTop).toFixed(1)} ${unit}` : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Avg Min Speed</span>
                  <span className="font-mono" style={{ color: 'hsl(0, 84%, 55%)' }}>
                    {avgMin !== null ? `${convertSpeed(avgMin).toFixed(1)} ${unit}` : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Deltas */}
            {(referenceLapNumber !== null || lapToFastestDelta !== null || deltaTopSpeed !== null || deltaMinSpeed !== null) && (
              <div className="pt-2 border-t border-border space-y-1">
                <div className="text-xs text-muted-foreground text-center mb-1">Δ {paceDiffLabel}</div>
                {lapToFastestDelta !== null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Δ Time</span>
                    <span className="font-mono" style={{ color: lapToFastestDelta < 0 ? 'hsl(142, 76%, 45%)' : lapToFastestDelta > 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}>
                      {lapToFastestDelta > 0 ? '+' : ''}{(lapToFastestDelta / 1000).toFixed(3)}s
                    </span>
                  </div>
                )}
                {deltaTopSpeed !== null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Δ Top Speed</span>
                    <span className="font-mono" style={{ color: deltaTopSpeed > 0 ? 'hsl(142, 76%, 45%)' : deltaTopSpeed < 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}>
                      {deltaTopSpeed > 0 ? '+' : ''}{convertSpeed(deltaTopSpeed).toFixed(1)} {unit}
                    </span>
                  </div>
                )}
                {deltaMinSpeed !== null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Δ Min Speed</span>
                    <span className="font-mono" style={{ color: deltaMinSpeed > 0 ? 'hsl(142, 76%, 45%)' : deltaMinSpeed < 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}>
                      {deltaMinSpeed > 0 ? '+' : ''}{convertSpeed(deltaMinSpeed).toFixed(1)} {unit}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Weather - always shown */}
            <div className="pt-2 border-t border-border">
              <WeatherPanel
                lat={sessionGpsPoint?.lat}
                lon={sessionGpsPoint?.lon}
                sessionDate={sessionStartDate}
                cachedStation={cachedWeatherStation}
                onStationResolved={onWeatherStationResolved}
                detailed
              />
            </div>
          </>
        ) : (
          /* Kart tab */
          <>
            {sessionKartId && selectedKart ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Kart</span>
                    <span className="font-mono text-foreground">{selectedKart.name}</span>
                  </div>
                  {selectedKart.number > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Number</span>
                      <span className="font-mono text-foreground">#{selectedKart.number}</span>
                    </div>
                  )}
                  {selectedKart.engine && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Engine</span>
                      <span className="font-mono text-foreground">{selectedKart.engine}</span>
                    </div>
                  )}
                  {selectedKart.weight > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Weight</span>
                      <span className="font-mono text-foreground">{selectedKart.weight} {selectedKart.weightUnit}</span>
                    </div>
                  )}
                </div>

                {/* Setup display */}
                {selectedSetup ? (
                  <div className="pt-2 border-t border-border space-y-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-foreground">{selectedSetup.name}</span>
                      {onOpenSetupEditor && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onOpenSetupEditor(selectedSetup.id)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <SetupDetails setup={selectedSetup} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pt-2 border-t border-border">No setup linked to session</p>
                )}
              </div>
            ) : (
              /* No kart linked - show selector */
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Link a kart and setup to this session:</p>
                <Select value={selectedKartId ?? 'none'} onValueChange={handleKartChange}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select kart…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No kart</SelectItem>
                    {karts.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedSetupId ?? 'none'}
                  onValueChange={handleSetupChange}
                  disabled={!selectedKartId || filteredSetups.length === 0}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder={!selectedKartId ? 'Select kart first' : filteredSetups.length === 0 ? 'No setups' : 'Select setup…'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No setup</SelectItem>
                    {filteredSetups.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button className="w-full" size="sm" onClick={handleSave} disabled={isSaved}>
                  Save Selection
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Read-only display of all setup fields */
function SetupDetails({ setup }: { setup: KartSetup }) {
  const rows: { label: string; value: string }[] = [];

  const add = (label: string, value: string | number | null | undefined, suffix = '') => {
    if (value !== null && value !== undefined && value !== '' && value !== 0) {
      rows.push({ label, value: `${value}${suffix}` });
    }
  };

  add('Toe', setup.toe);
  add('Camber', setup.camber);
  add('Castor', setup.castor);
  add('Front Width', setup.frontWidth, ` ${setup.frontWidthUnit}`);
  add('Rear Width', setup.rearWidth, ` ${setup.rearWidthUnit}`);
  add('Rear Height', setup.rearHeight, ` ${setup.rearHeightUnit}`);
  add('Front Sprocket', setup.frontSprocket);
  add('Rear Sprocket', setup.rearSprocket);
  if (setup.frontSprocket && setup.rearSprocket) {
    rows.push({ label: 'Ratio', value: (setup.rearSprocket / setup.frontSprocket).toFixed(3) });
  }
  add('Steering Brand', setup.steeringBrand);
  add('Steering Setting', setup.steeringSetting);
  add('Spindle Setting', setup.spindleSetting);
  add('Tire Brand', setup.tireBrand);

  // PSI
  if (setup.psiFrontLeft !== null) {
    if (setup.psiFrontLeft === setup.psiFrontRight && setup.psiRearLeft === setup.psiRearRight && setup.psiFrontLeft === setup.psiRearLeft) {
      add('PSI (all)', setup.psiFrontLeft?.toFixed(2));
    } else if (setup.psiFrontLeft === setup.psiFrontRight && setup.psiRearLeft === setup.psiRearRight) {
      add('PSI Front', setup.psiFrontLeft?.toFixed(2));
      add('PSI Rear', setup.psiRearLeft?.toFixed(2));
    } else {
      add('PSI FL', setup.psiFrontLeft?.toFixed(2));
      add('PSI FR', setup.psiFrontRight?.toFixed(2));
      add('PSI RL', setup.psiRearLeft?.toFixed(2));
      add('PSI RR', setup.psiRearRight?.toFixed(2));
    }
  }

  // Tire width
  if (setup.tireWidthFrontLeft !== null) {
    const u = setup.tireWidthUnit;
    if (setup.tireWidthFrontLeft === setup.tireWidthFrontRight && setup.tireWidthRearLeft === setup.tireWidthRearRight) {
      add('Tire Width Front', setup.tireWidthFrontLeft?.toFixed(2), ` ${u}`);
      add('Tire Width Rear', setup.tireWidthRearLeft?.toFixed(2), ` ${u}`);
    } else {
      add('Tire Width FL', setup.tireWidthFrontLeft?.toFixed(2), ` ${u}`);
      add('Tire Width FR', setup.tireWidthFrontRight?.toFixed(2), ` ${u}`);
      add('Tire Width RL', setup.tireWidthRearLeft?.toFixed(2), ` ${u}`);
      add('Tire Width RR', setup.tireWidthRearRight?.toFixed(2), ` ${u}`);
    }
  }

  // Tire diameter
  if (setup.tireDiameterFrontLeft !== null) {
    const u = setup.tireDiameterUnit;
    if (setup.tireDiameterFrontLeft === setup.tireDiameterFrontRight && setup.tireDiameterRearLeft === setup.tireDiameterRearRight) {
      add('Tire Diameter Front', setup.tireDiameterFrontLeft?.toFixed(2), ` ${u}`);
      add('Tire Diameter Rear', setup.tireDiameterRearLeft?.toFixed(2), ` ${u}`);
    } else {
      add('Tire Diameter FL', setup.tireDiameterFrontLeft?.toFixed(2), ` ${u}`);
      add('Tire Diameter FR', setup.tireDiameterFrontRight?.toFixed(2), ` ${u}`);
      add('Tire Diameter RL', setup.tireDiameterRearLeft?.toFixed(2), ` ${u}`);
      add('Tire Diameter RR', setup.tireDiameterRearRight?.toFixed(2), ` ${u}`);
    }
  }

  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No setup data</p>;

  return (
    <div className="space-y-0.5">
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between text-xs">
          <span className="text-muted-foreground">{r.label}</span>
          <span className="font-mono text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
