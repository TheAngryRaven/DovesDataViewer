import { memo } from 'react';
import { GraphViewPanel } from '@/components/graphview/GraphViewPanel';
import { useSessionContext } from '@/contexts/SessionContext';

export const GraphViewTab = memo(function GraphViewTab() {
  const s = useSessionContext();
  return (
    <GraphViewPanel
      visibleSamples={s.visibleSamples}
      filteredSamples={s.filteredSamples}
      referenceSamples={s.referenceSamples}
      currentIndex={s.currentIndex}
      onScrub={s.onScrub}
      fieldMappings={s.fieldMappings}
      course={s.course}
      lapTimeMs={s.selectedLapTimeMs}
      paceDiff={s.paceDiff}
      paceDiffLabel={s.paceDiffLabel}
      deltaTopSpeed={s.deltaTopSpeed}
      deltaMinSpeed={s.deltaMinSpeed}
      referenceLapNumber={s.referenceLapNumber}
      lapToFastestDelta={s.lapToFastestDelta}
      bounds={s.bounds!}
      sessionGpsPoint={s.sessionGpsPoint}
      sessionStartDate={s.sessionStartDate}
      cachedWeatherStation={s.cachedWeatherStation}
      onWeatherStationResolved={s.onWeatherStationResolved}
      vehicles={s.vehicles}
      setups={s.setups}
      templates={s.templates}
      sessionKartId={s.sessionKartId}
      sessionSetupId={s.sessionSetupId}
      onSaveSessionSetup={s.onSaveSessionSetup}
      visibleRange={s.visibleRange}
      onRangeChange={s.onRangeChange}
      minRange={s.minRange}
      formatRangeLabel={s.formatRangeLabel}
      videoState={s.videoState}
      videoActions={s.videoActions}
      onVideoLoadedMetadata={s.onVideoLoadedMetadata}
      currentSample={s.currentSample}
      sessionFileName={s.sessionFileName}
      isAllLaps={s.isAllLaps}
      allSamples={s.allSamples}
      laps={s.laps}
      selectedLapNumber={s.selectedLapNumber}
      paceData={s.paceData}
      overlayLines={s.overlayLines}
      onRemoveOverlay={s.onToggleOverlay}
      alignOverlays={s.alignOverlays}
      onToggleAlignOverlays={s.onToggleAlignOverlays}
    />
  );
});
