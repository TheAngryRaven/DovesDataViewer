import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GpsSample, Course, FieldMapping, Lap } from '@/types/racing';
import { findSpeedEvents } from '@/lib/speedEvents';
import { formatLapTime } from '@/lib/lapCalculation';
import { Vehicle } from '@/lib/vehicleStorage';
import { VehicleSetup } from '@/lib/setupStorage';
import { SetupTemplate } from '@/lib/templateStorage';
import { WeatherPanel } from '@/components/WeatherPanel';
import { WeatherStation } from '@/lib/weatherService';
import { useSettingsContext } from '@/contexts/SettingsContext';
import { VideoPlayer } from '@/components/VideoPlayer';
import type { VideoSyncState, VideoSyncActions } from '@/hooks/useVideoSync';

interface InfoBoxProps {
  filteredSamples: GpsSample[];
  course: Course | null;
  lapTimeMs: number | null;
  paceDiff: number | null;
  paceDiffLabel: 'best' | 'ref';
  deltaTopSpeed: number | null;
  deltaMinSpeed: number | null;
  referenceLapNumber: number | null;
  lapToFastestDelta: number | null;
  sessionGpsPoint?: { lat: number; lon: number };
  sessionStartDate?: Date;
  cachedWeatherStation: WeatherStation | null;
  onWeatherStationResolved: (station: WeatherStation) => void;
  vehicles: Vehicle[];
  setups: VehicleSetup[];
  templates: SetupTemplate[];
  sessionKartId: string | null;
  sessionSetupId: string | null;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
  onOpenSetupEditor?: (setupId: string) => void;
  onOpenGarage?: (garageTab?: 'files' | 'vehicles' | 'setups') => void;
  videoState?: VideoSyncState;
  videoActions?: VideoSyncActions;
  onVideoLoadedMetadata?: () => void;
  // New props for video overlay system
  visibleSamples?: GpsSample[];
  allSamples?: GpsSample[];
  fieldMappings?: FieldMapping[];
  laps?: Lap[];
  selectedLapNumber?: number | null;
  referenceSamples?: GpsSample[];
  paceData?: (number | null)[];
  sessionFileName?: string | null;
  /** Hide the Video tab — the player was relocated into the graph stack (mobile),
   *  and two players can't share the single video element ref. */
  hideVideoTab?: boolean;
  /** Read-only leaderboard view: hide the Video tab + weather panel. */
  readOnly?: boolean;
}

type InfoTab = 'data' | 'vehicle' | 'video';

export function InfoBox({
  filteredSamples, course, lapTimeMs, paceDiff, paceDiffLabel,
  deltaTopSpeed, deltaMinSpeed, referenceLapNumber, lapToFastestDelta,
  sessionGpsPoint, sessionStartDate, cachedWeatherStation, onWeatherStationResolved,
  vehicles, setups, templates, sessionKartId, sessionSetupId, onSaveSessionSetup, onOpenSetupEditor, onOpenGarage,
  videoState, videoActions, onVideoLoadedMetadata,
  visibleSamples, allSamples, fieldMappings, laps, selectedLapNumber,
  referenceSamples, paceData, sessionFileName, hideVideoTab, readOnly = false,
}: InfoBoxProps) {
  const { t } = useTranslation('session');
  const { useKph } = useSettingsContext();
  const [tab, setTab] = useState<InfoTab>('data');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(sessionKartId);
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(sessionSetupId);

  useEffect(() => { setSelectedVehicleId(sessionKartId); setSelectedSetupId(sessionSetupId); }, [sessionKartId, sessionSetupId]);

  // If the video panel was relocated while this tab was open, fall back to data.
  useEffect(() => { if ((hideVideoTab || readOnly) && tab === 'video') setTab('data'); }, [hideVideoTab, readOnly, tab]);

  const unit = useKph ? 'kph' : 'mph';
  const convertSpeed = (speed: number) => useKph ? speed * 1.60934 : speed;

  const speedEvents = useMemo(() => {
    if (filteredSamples.length < 10) return [];
    return findSpeedEvents(filteredSamples, { smoothingWindow: 5, minSwing: 3, minSeparationMs: 1000, debounceCount: 2 });
  }, [filteredSamples]);

  const peaks = speedEvents.filter(e => e.type === 'peak');
  const valleys = speedEvents.filter(e => e.type === 'valley');
  const avgTop = peaks.length > 0 ? peaks.reduce((s, e) => s + e.speed, 0) / peaks.length : null;
  const avgMin = valleys.length > 0 ? valleys.reduce((s, e) => s + e.speed, 0) / valleys.length : null;

  const filteredSetups = useMemo(() => {
    if (!selectedVehicleId) return [];
    return setups.filter(s => s.vehicleId === selectedVehicleId);
  }, [setups, selectedVehicleId]);

  const selectedVehicle = vehicles.find(v => v.id === sessionKartId);
  const selectedSetup = setups.find(s => s.id === sessionSetupId);
  const isSaved = selectedVehicleId === sessionKartId && selectedSetupId === sessionSetupId;

  const handleVehicleChange = useCallback((v: string) => {
    setSelectedVehicleId(v === 'none' ? null : v);
    setSelectedSetupId(null);
  }, []);

  const handleSetupChange = useCallback((v: string) => {
    setSelectedSetupId(v === 'none' ? null : v);
  }, []);

  const handleSave = useCallback(async () => {
    await onSaveSessionSetup(selectedVehicleId, selectedSetupId);
  }, [selectedVehicleId, selectedSetupId, onSaveSessionSetup]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-card border-b border-border">
      <div className="flex shrink-0 border-b border-border">
        <button onClick={() => setTab('data')} className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'data' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}>{t('infoBox.tabData')}</button>
        <button onClick={() => setTab('vehicle')} className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'vehicle' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}>{t('infoBox.tabVehicle')}</button>
        {!hideVideoTab && !readOnly && (
          <button onClick={() => setTab('video')} className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${tab === 'video' ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}>{t('infoBox.tabVideo')}</button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'video' && videoState && videoActions && onVideoLoadedMetadata ? (
          <div className="h-full">
            <VideoPlayer
              state={videoState}
              actions={videoActions}
              onLoadedMetadata={onVideoLoadedMetadata}
              samples={visibleSamples}
              allSamples={allSamples}
              fieldMappings={fieldMappings}
              laps={laps}
              selectedLapNumber={selectedLapNumber}
              course={course}
              referenceSamples={referenceSamples}
              paceData={paceData}
              sessionFileName={sessionFileName}
            />
          </div>
        ) : (
        <div className="p-3 space-y-3">
        {tab === 'data' ? (
          <>
            {lapTimeMs !== null && (
              <div className="flex justify-between text-xs pb-2 border-b border-border">
                <span className="text-muted-foreground">{t('stats.lapTime')}</span>
                <span className="font-mono text-foreground font-semibold">{formatLapTime(lapTimeMs)}</span>
              </div>
            )}
            {course && speedEvents.length > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t('stats.avgTopSpeed')}</span>
                  <span className="font-mono" style={{ color: 'hsl(142, 76%, 45%)' }}>{avgTop !== null ? `${convertSpeed(avgTop).toFixed(1)} ${unit}` : '—'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t('stats.avgMinSpeed')}</span>
                  <span className="font-mono" style={{ color: 'hsl(0, 84%, 55%)' }}>{avgMin !== null ? `${convertSpeed(avgMin).toFixed(1)} ${unit}` : '—'}</span>
                </div>
              </div>
            )}
            {(referenceLapNumber !== null || lapToFastestDelta !== null || deltaTopSpeed !== null || deltaMinSpeed !== null) && (
              <div className="pt-2 border-t border-border space-y-1">
                <div className="text-xs text-muted-foreground text-center mb-1">Δ {paceDiffLabel === 'best' ? t('stats.best') : t('stats.ref')}</div>
                {lapToFastestDelta !== null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Δ {t('stats.time')}</span>
                    <span className="font-mono" style={{ color: lapToFastestDelta < 0 ? 'hsl(142, 76%, 45%)' : lapToFastestDelta > 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}>
                      {lapToFastestDelta > 0 ? '+' : ''}{(lapToFastestDelta / 1000).toFixed(3)}s
                    </span>
                  </div>
                )}
                {deltaTopSpeed !== null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Δ {t('stats.topSpeed')}</span>
                    <span className="font-mono" style={{ color: deltaTopSpeed > 0 ? 'hsl(142, 76%, 45%)' : deltaTopSpeed < 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}>
                      {deltaTopSpeed > 0 ? '+' : ''}{convertSpeed(deltaTopSpeed).toFixed(1)} {unit}
                    </span>
                  </div>
                )}
                {deltaMinSpeed !== null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Δ {t('stats.minSpeed')}</span>
                    <span className="font-mono" style={{ color: deltaMinSpeed > 0 ? 'hsl(142, 76%, 45%)' : deltaMinSpeed < 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}>
                      {deltaMinSpeed > 0 ? '+' : ''}{convertSpeed(deltaMinSpeed).toFixed(1)} {unit}
                    </span>
                  </div>
                )}
              </div>
            )}
            {!readOnly && (
              <div className="pt-2 border-t border-border">
                <WeatherPanel lat={sessionGpsPoint?.lat} lon={sessionGpsPoint?.lon} sessionDate={sessionStartDate} cachedStation={cachedWeatherStation} onStationResolved={onWeatherStationResolved} detailed />
              </div>
            )}
          </>
        ) : (
          /* Vehicle tab */
          <>
            {sessionKartId && selectedVehicle ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t('infoBox.vehicle')}</span>
                    <span className="font-mono text-foreground">{selectedVehicle.name}</span>
                  </div>
                  {selectedVehicle.number > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t('infoBox.number')}</span>
                      <span className="font-mono text-foreground">#{selectedVehicle.number}</span>
                    </div>
                  )}
                  {selectedVehicle.engine && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t('infoBox.engine')}</span>
                      <span className="font-mono text-foreground">{selectedVehicle.engine}</span>
                    </div>
                  )}
                  {selectedVehicle.weight > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t('infoBox.weight')}</span>
                      <span className="font-mono text-foreground">{selectedVehicle.weight} {selectedVehicle.weightUnit}</span>
                    </div>
                  )}
                </div>
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
                    <SetupDetails setup={selectedSetup} templates={templates} />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pt-2 border-t border-border">{t('infoBox.noSetupLinked')}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t('infoBox.linkPrompt')}</p>
                <Select value={selectedVehicleId ?? 'none'} onValueChange={handleVehicleChange}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t('infoBox.selectVehicle')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('infoBox.noVehicle')}</SelectItem>
                    {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={selectedSetupId ?? 'none'} onValueChange={handleSetupChange} disabled={!selectedVehicleId || filteredSetups.length === 0}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder={!selectedVehicleId ? t('infoBox.selectVehicleFirst') : filteredSetups.length === 0 ? t('infoBox.noSetups') : t('infoBox.selectSetup')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('infoBox.noSetup')}</SelectItem>
                    {filteredSetups.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button className="w-full" size="sm" onClick={handleSave} disabled={isSaved}>{t('infoBox.saveSelection')}</Button>
                {onOpenGarage && (
                  <Button
                    variant="outline"
                    className="w-full"
                    size="sm"
                    onClick={() => onOpenGarage(vehicles.length > 0 ? 'setups' : 'vehicles')}
                  >
                    {t('infoBox.openGarage')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        </div>
        )}
      </div>
    </div>
  );
}

/** Read-only display of setup fields — now dynamic from template */
function SetupDetails({ setup, templates }: { setup: VehicleSetup; templates: SetupTemplate[] }) {
  const { t } = useTranslation("drawer");
  const template = templates.find(tpl => tpl.id === setup.templateId);
  const rows: { label: string; value: string }[] = [];

  const add = (label: string, value: string | number | null | undefined, suffix = '') => {
    if (value !== null && value !== undefined && value !== '' && value !== 0) {
      rows.push({ label, value: `${value}${suffix}` });
    }
  };

  if (template) {
    for (const section of template.sections) {
      for (const field of section.fields) {
        const val = setup.customFields[field.id];
        const displayUnit = (field.unit === "mm" || field.unit === "in") ? (setup.unitSystem || "mm") : field.unit;
        add(field.name, val, displayUnit ? ` ${displayUnit}` : "");
      }
    }
    const frontSprocket = setup.customFields["f-front-sprocket"];
    const rearSprocket = setup.customFields["f-rear-sprocket"];
    if (typeof frontSprocket === "number" && typeof rearSprocket === "number" && frontSprocket > 0) {
      rows.push({ label: t("setupDetails.ratio"), value: (rearSprocket / frontSprocket).toFixed(3) });
    }
  }

  add(t("setupDetails.tireBrand"), setup.tireBrand);
  if (setup.psiFrontLeft !== null) {
    if (setup.psiFrontLeft === setup.psiFrontRight && setup.psiRearLeft === setup.psiRearRight && setup.psiFrontLeft === setup.psiRearLeft) {
      add(t("setupDetails.psiAll"), setup.psiFrontLeft?.toFixed(2));
    } else if (setup.psiFrontLeft === setup.psiFrontRight && setup.psiRearLeft === setup.psiRearRight) {
      add(t("setupDetails.psiFront"), setup.psiFrontLeft?.toFixed(2));
      add(t("setupDetails.psiRear"), setup.psiRearLeft?.toFixed(2));
    } else {
      add(t("setupDetails.psiFL"), setup.psiFrontLeft?.toFixed(2));
      add(t("setupDetails.psiFR"), setup.psiFrontRight?.toFixed(2));
      add(t("setupDetails.psiRL"), setup.psiRearLeft?.toFixed(2));
      add(t("setupDetails.psiRR"), setup.psiRearRight?.toFixed(2));
    }
  }
  const wu = setup.unitSystem || "mm";
  if (setup.tireWidthFrontLeft !== null) {
    if (setup.tireWidthFrontLeft === setup.tireWidthFrontRight && setup.tireWidthRearLeft === setup.tireWidthRearRight) {
      add(t("setupDetails.tireWidthFront"), setup.tireWidthFrontLeft?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireWidthRear"), setup.tireWidthRearLeft?.toFixed(2), ` ${wu}`);
    } else {
      add(t("setupDetails.tireWidthFL"), setup.tireWidthFrontLeft?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireWidthFR"), setup.tireWidthFrontRight?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireWidthRL"), setup.tireWidthRearLeft?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireWidthRR"), setup.tireWidthRearRight?.toFixed(2), ` ${wu}`);
    }
  }
  if (setup.tireDiameterFrontLeft !== null) {
    if (setup.tireDiameterFrontLeft === setup.tireDiameterFrontRight && setup.tireDiameterRearLeft === setup.tireDiameterRearRight) {
      add(t("setupDetails.tireDiameterFront"), setup.tireDiameterFrontLeft?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireDiameterRear"), setup.tireDiameterRearLeft?.toFixed(2), ` ${wu}`);
    } else {
      add(t("setupDetails.tireDiameterFL"), setup.tireDiameterFrontLeft?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireDiameterFR"), setup.tireDiameterFrontRight?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireDiameterRL"), setup.tireDiameterRearLeft?.toFixed(2), ` ${wu}`);
      add(t("setupDetails.tireDiameterRR"), setup.tireDiameterRearRight?.toFixed(2), ` ${wu}`);
    }
  }

  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{t("setupDetails.noSetupData")}</p>;

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
