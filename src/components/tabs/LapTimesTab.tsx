import { memo } from "react";
import { LapTable } from "@/components/LapTable";
import { useSessionContext } from "@/contexts/SessionContext";

export const LapTimesTab = memo(function LapTimesTab() {
  const s = useSessionContext();
  return (
    <div className="h-full overflow-hidden">
      <LapTable
        laps={s.laps}
        course={s.course}
        samples={s.allSamples}
        onLapSelect={s.onLapSelect}
        selectedLapNumber={s.selectedLapNumber}
        referenceLapNumber={s.referenceLapNumber}
        onSetReference={s.onSetReference}
        externalRefLabel={s.externalRefLabel}
        savedFiles={s.savedFiles}
        onLoadFileForRef={s.onLoadFileForRef}
        onSelectExternalLap={s.onSelectExternalLap}
        onClearExternalRef={s.onClearExternalRef}
        onRefreshSavedFiles={s.onRefreshSavedFiles}
        snapshotsForCourse={s.snapshotsForCourse}
        activeSnapshotId={s.activeSnapshotId}
        canSnapshot={s.canSnapshot}
        onLoadSnapshot={s.onLoadSnapshot}
        onClearSnapshot={s.onClearSnapshot}
        onSaveSnapshot={s.onSaveSnapshot}
      />
    </div>
  );
});
