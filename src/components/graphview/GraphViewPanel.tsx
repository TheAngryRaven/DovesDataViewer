import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
import { GraphRangeControl } from './GraphRangeControl';
import { SecondaryGraphStack } from './SecondaryGraphStack';
import { formatLapTime } from '@/lib/lapCalculation';
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
  // Split graphs: a second stack bound to one enabled overlay lap (tablet+).
  splitActive?: boolean;
  splitOverlayId?: string | null;
  /** Turn split off (re-opening the side panel == Combine graphs). */
  onCombineSplit?: () => void;
}

export function GraphViewPanel(props: GraphViewPanelProps) {
  const { t } = useTranslation('session');
  const isMobile = useIsMobile();
  const [mapVisible, setMapVisible] = useState(true);
  const mapPanelRef = useRef<ImperativePanelHandle>(null);
  const savedSizeRef = useRef(30);

  // The left InfoBox/MiniMap column can be collapsed (any screen size) so the
  // graphs get the full width. Video + mini-map are then reachable as graph
  // panels. Split-graphs also collapses it (the comparison needs the width).
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  // Relocated panels active in the graph stack (reported by GraphPanel) — used
  // to avoid mounting a duplicate VideoPlayer (it binds a single shared ref).
  const [relocated, setRelocated] = useState({ video: false, miniMap: false });
  // Main panel's active graph set, mirrored onto the split secondary stack.
  const [mirror, setMirror] = useState<{ activeGraphs: string[]; graphHeights: Record<string, number> }>({ activeGraphs: [], graphHeights: {} });

  const { splitActive = false, splitOverlayId = null, onCombineSplit } = props;
  const selectedOverlay = useMemo(
    () => (splitActive ? props.overlayLines?.find((o) => o.id === splitOverlayId) ?? null : null),
    [splitActive, splitOverlayId, props.overlayLines],
  );
  const showSplit = splitActive && !!selectedOverlay;
  // The mirror video is a literal second player: only for an in-session lap, with
  // a synced video that the user has relocated into the (main) graph stack.
  const splitVideoEnabled = !!splitOverlayId?.startsWith('lap:') && !!props.videoState?.videoUrl && relocated.video;

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

  // Split mode hides the side panel (the comparison needs the width); leaving it
  // restores the panel. Kept in a ref so the onExpand handler reads live state.
  const splitActiveRef = useRef(showSplit);
  splitActiveRef.current = showSplit;
  useEffect(() => {
    const panel = leftPanelRef.current;
    if (!panel) return;
    if (showSplit) panel.collapse();
    else panel.expand();
  }, [showSplit]);

  // Re-opening the side panel is the same as clicking "Combine graphs".
  const handleLeftExpand = useCallback(() => {
    setLeftCollapsed(false);
    if (splitActiveRef.current) onCombineSplit?.();
  }, [onCombineSplit]);

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

  const handleMirrorChange = useCallback(
    (activeGraphs: string[], graphHeights: Record<string, number>) => setMirror({ activeGraphs, graphHeights }),
    [],
  );

  // In split mode the main panel drops the right-selected overlay (it lives on
  // the right) and draws only the remaining overlays — which the left header then
  // legends, after the main lap.
  const mainOverlayLines = showSplit
    ? (props.overlayLines ?? []).filter((o) => o.id !== splitOverlayId)
    : props.overlayLines;

  const mainLapLabel = props.selectedLapNumber != null
    ? (props.lapTimeMs != null
        ? `${t('header.lap', { number: props.selectedLapNumber })} · ${formatLapTime(props.lapTimeMs)}`
        : t('header.lap', { number: props.selectedLapNumber }))
    : t('header.allLaps');

  // Single-line legend (CSS ellipsis on overflow): main lap, then the overlays
  // still drawn on the left. Matches the right panel's header height so the
  // graph rows line up across both stacks.
  const mainHeader = (
    <span className="block min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
      <span className="text-foreground">{mainLapLabel}</span>
      {(mainOverlayLines ?? []).map((o) => (
        <span key={o.id}>
          <span className="text-muted-foreground/50"> · </span>
          <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: o.color }} />
          <span className="align-middle"> {o.label}</span>
        </span>
      ))}
    </span>
  );

  // The main (left) graph stack. Split mode also lets it relocate the video /
  // mini-map into the stack (the side panel is hidden), so the user can sync a
  // video and have it mirror onto the comparison panel.
  const mainGraphPanel = (
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
      overlayLines={mainOverlayLines}
      course={props.course}
      laps={props.laps}
      selectedLapNumber={props.selectedLapNumber}
      enableMobilePanels={isMobile || leftCollapsed || showSplit}
      renderVideo={canRenderVideo ? renderVideo : undefined}
      renderMiniMap={renderMiniMap}
      onMobilePanelsChange={setRelocated}
      onActiveGraphsChange={handleMirrorChange}
      header={showSplit ? mainHeader : undefined}
      hideRangeControl={showSplit}
    />
  );

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
        onExpand={handleLeftExpand}
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
        <div className="relative h-full flex flex-col">
          <button
            onClick={toggleLeftPanel}
            className="absolute top-2 left-0 z-[1100] flex items-center py-3 pl-0.5 pr-1 rounded-r-md bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
            title={leftCollapsed ? t('graphs.expandPanel') : t('graphs.collapsePanel')}
            aria-label={leftCollapsed ? t('graphs.expandPanel') : t('graphs.collapsePanel')}
          >
            {leftCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          {/* Always a horizontal group with a stable main panel id, so toggling
              split only mounts/unmounts the secondary — the main stack (and its
              graph state) stays put. */}
          <div className="flex-1 min-h-0">
            <ResizablePanelGroup direction="horizontal" className="h-full">
              <ResizablePanel id="graph-main" order={1} defaultSize={showSplit ? 50 : 100} minSize={25}>
                {mainGraphPanel}
              </ResizablePanel>
              {showSplit && (
                <>
                  <ResizableHandle />
                  <ResizablePanel id="graph-secondary" order={2} defaultSize={50} minSize={25}>
                    <SecondaryGraphStack
                      overlay={selectedOverlay!}
                      activeGraphs={mirror.activeGraphs}
                      graphHeights={mirror.graphHeights}
                      mainFilteredSamples={props.filteredSamples}
                      visibleRange={props.visibleRange}
                      referenceSamples={props.referenceSamples}
                      fieldMappings={props.fieldMappings}
                      course={props.course}
                      laps={props.laps ?? []}
                      selectedLapNumber={props.selectedLapNumber ?? null}
                      bounds={props.bounds}
                      sessionFileName={props.sessionFileName}
                      onScrub={props.onScrub}
                      videoState={props.videoState}
                      videoEnabled={splitVideoEnabled}
                      onCommitRateAnchor={props.videoActions?.addRateAnchor}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
          {/* Single shared range/crop control spanning both panels in split. */}
          {showSplit && (
            <GraphRangeControl
              filteredSamples={props.filteredSamples}
              visibleRange={props.visibleRange}
              onRangeChange={props.onRangeChange}
              minRange={props.minRange}
              formatRangeLabel={props.formatRangeLabel}
              course={props.course}
              laps={props.laps}
              selectedLapNumber={props.selectedLapNumber}
            />
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
