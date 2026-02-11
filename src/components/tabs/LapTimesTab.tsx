import { LapTable } from "@/components/LapTable";
import { Lap, Course } from "@/types/racing";
import { FileEntry } from "@/lib/fileStorage";

interface LapTimesTabProps {
  laps: Lap[];
  course: Course | null;
  onLapSelect: (lap: Lap) => void;
  selectedLapNumber: number | null;
  referenceLapNumber: number | null;
  onSetReference: (lapNumber: number) => void;
  externalRefLabel: string | null;
  savedFiles: FileEntry[];
  onLoadFileForRef: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  onSelectExternalLap: (fileName: string, lapNumber: number) => void;
  onClearExternalRef: () => void;
  onRefreshSavedFiles: () => void;
}

export function LapTimesTab(props: LapTimesTabProps) {
  return (
    <div className="h-full overflow-hidden">
      <LapTable
        laps={props.laps}
        course={props.course}
        onLapSelect={props.onLapSelect}
        selectedLapNumber={props.selectedLapNumber}
        referenceLapNumber={props.referenceLapNumber}
        onSetReference={props.onSetReference}
        externalRefLabel={props.externalRefLabel}
        savedFiles={props.savedFiles}
        onLoadFileForRef={props.onLoadFileForRef}
        onSelectExternalLap={props.onSelectExternalLap}
        onClearExternalRef={props.onClearExternalRef}
        onRefreshSavedFiles={props.onRefreshSavedFiles}
      />
    </div>
  );
}
