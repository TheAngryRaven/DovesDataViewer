import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { GpsSample, Course, FieldMapping, Lap } from '@/types/racing';
import type { OverlayLine } from '@/lib/lapOverlays';
import { Vehicle } from '@/lib/vehicleStorage';
import { VehicleSetup } from '@/lib/setupStorage';
import { SetupTemplate } from '@/lib/templateStorage';
import { WeatherStation } from '@/lib/weatherService';
import type { VideoSyncState, VideoSyncActions } from '@/hooks/useVideoSync';
import { InfoBox } from './InfoBox';
import { MiniMap } from './MiniMap';
import { GraphPanel } from './GraphPanel';
import { VideoPlayer } from '@/components/VideoPlayer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Map as MapIcon, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { ImperativePanelHandle } from 'react-resizable-panels';
import { useIsMobile } from '@/hooks/use-mobile';

export interface GraphViewPanelProps {
  // Data
  visibleSamples: GpsSample[];
  filteredSamples: GpsSample[];
  referenceSamples: GpsSample[];
  onScrub: (index: number) => void;
  fieldMappings: FieldMapping[];
  // Stats
  course: Course | null;
  lapTimeMs: number | null;
  paceDiff: number | null;
  paceDiffLabel: 'best' | 'ref';
  deltaTopSpeed: number | null;
  deltaMinSpeed: number | null;
  referenceLapNumber: number | null;
  lapToFastestDelta: number | null;
  // Map
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  // Weather
  sessionGpsPoint?: { lat: number; lon: number };
  sessionStartDate?: Date;
  cachedWeatherStation: WeatherStation | null;
  onWeatherStationResolved: (station: WeatherStation) => void;
  // Vehicle/setup
  vehicles: Vehicle[];
  setups: VehicleSetup[];
  templates: SetupTemplate[];
  sessionKartId: string | null;
  sessionSetupId: string | null;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
  onOpenSetupEditor?: (setupId: string) => void;
  onOpenGarage?: (garageTab?: 'files' | 'vehicles' | 'setups') => void;
  // Range slider
  visibleRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  minRange: number;
  formatRangeLabel: (idx: number) => string;
  // Video
  videoState?: VideoSyncState;
  videoActions?: VideoSyncActions;
  onVideoLoadedMetadata?: () => void;
  // Session
  sessionFileName: string | null;
  isAllLaps?: boolean;
  // New: for video overlays
  allSamples?: GpsSample[];
  laps?: Lap[];
  selectedLapNumber?: number | null;
  paceData?: (number | null)[];
  // Multi-lap overlay (extra racing lines drawn on the MiniMap)
  overlayLines?: OverlayLine[];
  onRemoveOverlay?: (id: string) => void;
  alignOverlays?: boolean;
  onToggleAlignOverlays?: () => void;
  showOverlayLegend?: boolean;
  onToggleOverlayLegend?: () => void;
}

export function GraphViewPanel(props: GraphViewPanelProps) {
  const { t } = useTranslation('session');
  const isMobile = useIsMobile();
  const [mapVisible, setMapVisible] = useState(true);
  const mapPanelRef = useRef<ImperativePanelHandle>(null);
  const savedSizeRef = useRef(30);

  // Mobile: the left InfoBox/MiniMap column can be collapsed so the graphs get
  // the full screen width. Video + mini-map are then reachable as graph panels.
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Relocated panels active in the graph stack (reported by GraphPanel) — used
  // to avoid mounting a duplicate VideoPlayer (it binds a single shared ref).
  const [relocated, setRelocated] = useState({ video: false, miniMap: false });

  const toggleMap = () => {
    const panel = mapPanelRef.current;
    if (!panel) return;
    if (mapVisible) {
      savedSizeRef.current = panel.getSize();
      panel.collapse();
      setMapVisible(false);
    } else {
      panel.expand();
      panel.resize(savedSizeRef.current);
      setMapVisible(true);
    }
  };

  const toggleLeftPanel = () => {
    const panel = leftPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  // Never leave the left panel collapsed once we're back on a wide layout.
  useEffect(() => {
    if (!isMobile) leftPanelRef.current?.expand();
  }, [isMobile]);

  const { videoState, videoActions, onVideoLoadedMetadata } = props;
  const canRenderVideo = !!(videoState && videoActions && onVideoLoadedMetadata);
  const renderVideo = useCallback(() => (
    <VideoPlayer
      state={videoState!}
      actions={videoActions!}
      onLoadedMetadata={onVideoLoadedMetadata!}
      samples={props.visibleSamples}
      allSamples={props.allSamples}
      fieldMappings={props.fieldMappings}
      laps={props.laps}
      selectedLapNumber={props.selectedLapNumber}
      course={props.course}
      referenceSamples={props.referenceSamples}
      paceData={props.paceData}
      sessionFileName={props.sessionFileName}
    />
  ), [videoState, videoActions, onVideoLoadedMetadata, props.visibleSamples, props.allSamples, props.fieldMappings, props.laps, props.selectedLapNumber, props.course, props.referenceSamples, props.paceData, props.sessionFileName]);

  const renderMiniMap = useCallback(() => (
    <MiniMap
      samples={props.visibleSamples}
      allSamples={props.filteredSamples}
      referenceSamples={props.referenceSamples}
      course={props.course}
      bounds={props.bounds}
      isAllLaps={props.isAllLaps}
      overlayLines={props.overlayLines}
      rangeStart={props.visibleRange[0]}
      onRemoveOverlay={props.onRemoveOverlay}
      alignOverlays={props.alignOverlays}
      onToggleAlignOverlays={props.onToggleAlignOverlays}
      showOverlayLegend={props.showOverlayLegend}
      onToggleOverlayLegend={props.onToggleOverlayLegend}
    />
  ), [props.visibleSamples, props.filteredSamples, props.referenceSamples, props.course, props.bounds, props.isAllLaps, props.overlayLines, props.visibleRange, props.onRemoveOverlay, props.alignOverlays, props.onToggleAlignOverlays, props.showOverlayLegend, props.onToggleOverlayLegend]);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel
        ref={leftPanelRef}
        defaultSize={30}
        minSize={20}
        maxSize={45}
        collapsible
        collapsedSize={0}
        onCollapse={() => setLeftCollapsed(true)}
        onExpand={() => setLeftCollapsed(false)}
      >
        <div className="h-full relative">
          <ResizablePanelGroup direction="vertical" className="h-full">
            <ResizablePanel defaultSize={70} minSize={30}>
              <InfoBox
                hideVideoTab={relocated.video}
                filteredSamples={props.filteredSamples}
                course={props.course}
                lapTimeMs={props.lapTimeMs}
                paceDiff={props.paceDiff}
                paceDiffLabel={props.paceDiffLabel}
                deltaTopSpeed={props.deltaTopSpeed}
                deltaMinSpeed={props.deltaMinSpeed}
                referenceLapNumber={props.referenceLapNumber}
                lapToFastestDelta={props.lapToFastestDelta}
                sessionGpsPoint={props.sessionGpsPoint}
                sessionStartDate={props.sessionStartDate}
                cachedWeatherStation={props.cachedWeatherStation}
                onWeatherStationResolved={props.onWeatherStationResolved}
                vehicles={props.vehicles}
                setups={props.setups}
                templates={props.templates}
                sessionKartId={props.sessionKartId}
                sessionSetupId={props.sessionSetupId}
                onSaveSessionSetup={props.onSaveSessionSetup}
                onOpenSetupEditor={props.onOpenSetupEditor}
                onOpenGarage={props.onOpenGarage}
                videoState={props.videoState}
                videoActions={props.videoActions}
                onVideoLoadedMetadata={props.onVideoLoadedMetadata}
                // New overlay props
                visibleSamples={props.visibleSamples}
                allSamples={props.allSamples}
                fieldMappings={props.fieldMappings}
                laps={props.laps}
                selectedLapNumber={props.selectedLapNumber}
                referenceSamples={props.referenceSamples}
                paceData={props.paceData}
                sessionFileName={props.sessionFileName}
              />
            </ResizablePanel>

            <ResizableHandle />

            <ResizablePanel
              ref={mapPanelRef}
              defaultSize={30}
              minSize={15}
              collapsible
              collapsedSize={0}
              onCollapse={() => setMapVisible(false)}
              onExpand={() => setMapVisible(true)}
            >
              <MiniMap
                samples={props.visibleSamples}
                allSamples={props.filteredSamples}
                referenceSamples={props.referenceSamples}
                course={props.course}
                bounds={props.bounds}
                isAllLaps={props.isAllLaps}
                overlayLines={props.overlayLines}
                rangeStart={props.visibleRange[0]}
                onRemoveOverlay={props.onRemoveOverlay}
                alignOverlays={props.alignOverlays}
                onToggleAlignOverlays={props.onToggleAlignOverlays}
                showOverlayLegend={props.showOverlayLegend}
                onToggleOverlayLegend={props.onToggleOverlayLegend}
              />
            </ResizablePanel>
          </ResizablePanelGroup>

          <button
            onClick={toggleMap}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-1 px-2 py-0.5 rounded bg-card/90 backdrop-blur-sm border border-border hover:bg-muted/50 text-muted-foreground text-xs"
          >
            {mapVisible ? <><EyeOff className="w-3 h-3" /> {t('graphs.hideMap')}</> : <><MapIcon className="w-3 h-3" /> {t('graphs.showMap')}</>}
          </button>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize={70} minSize={40}>
        <div className="relative h-full">
          {isMobile && (
            <button
              onClick={toggleLeftPanel}
              className="absolute top-2 left-0 z-[1100] flex items-center py-3 pl-0.5 pr-1 rounded-r-md bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
              title={leftCollapsed ? t('graphs.expandPanel') : t('graphs.collapsePanel')}
              aria-label={leftCollapsed ? t('graphs.expandPanel') : t('graphs.collapsePanel')}
            >
              {leftCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          )}
          <GraphPanel
            samples={props.visibleSamples}
            filteredSamples={props.filteredSamples}
            referenceSamples={props.referenceSamples}
            fieldMappings={props.fieldMappings}
            onScrub={props.onScrub}
            visibleRange={props.visibleRange}
            onRangeChange={props.onRangeChange}
            minRange={props.minRange}
            formatRangeLabel={props.formatRangeLabel}
            sessionFileName={props.sessionFileName}
            overlayLines={props.overlayLines}
            course={props.course}
            laps={props.laps}
            selectedLapNumber={props.selectedLapNumber}
            enableMobilePanels={isMobile}
            renderVideo={canRenderVideo ? renderVideo : undefined}
            renderMiniMap={renderMiniMap}
            onMobilePanelsChange={setRelocated}
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
