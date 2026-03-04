import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  HelpCircle,
  CloudOff,
  Upload,
  Download,
  GitCompare,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { BleConnection, requestTrackFileList, downloadTrackFile, uploadTrackFile } from "@/lib/bleDatalogger";
import {
  DeviceCourseJson,
  DeviceTrackFile,
  MergedTrackEntry,
  MergedCourseEntry,
  buildMergedTrackList,
  parseDeviceCourseJson,
  buildTrackJsonForUpload,
  deviceCourseToAppCourse,
  appCourseToDeviceJson,
  countAppSectors,
  countDeviceSectors,
  startADistance,
} from "@/lib/deviceTrackSync";
import { loadTracks, addTrack, addCourse } from "@/lib/trackStorage";
import { Track } from "@/types/racing";
import { toast } from "sonner";

interface DeviceTracksTabProps {
  connection: BleConnection;
}

type View = "loading" | "tracks" | "courses";

export function DeviceTracksTab({ connection }: DeviceTracksTabProps) {
  const [view, setView] = useState<View>("loading");
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0, label: "" });
  const [mergedTracks, setMergedTracks] = useState<MergedTrackEntry[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<MergedTrackEntry | null>(null);
  const [diffCourse, setDiffCourse] = useState<MergedCourseEntry | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  // Keep a ref of device files in memory for re-upload scenarios
  const [deviceFiles, setDeviceFiles] = useState<DeviceTrackFile[]>([]);
  const [appTracks, setAppTracks] = useState<Track[]>([]);

  const syncAll = useCallback(async () => {
    setView("loading");
    setSelectedTrack(null);
    try {
      setLoadProgress({ current: 0, total: 0, label: "Fetching track list…" });
      const filenames = await requestTrackFileList(connection);

      if (filenames.length === 0) {
        setLoadProgress({ current: 0, total: 0, label: "No track files on device" });
      }

      const files: DeviceTrackFile[] = [];
      for (let i = 0; i < filenames.length; i++) {
        const fn = filenames[i];
        setLoadProgress({ current: i + 1, total: filenames.length, label: fn });
        try {
          const raw = await downloadTrackFile(connection, fn);
          const text = new TextDecoder().decode(raw);
          const courses = parseDeviceCourseJson(text);
          files.push({ shortName: fn.replace(/\.json$/i, ""), courses });
        } catch (err) {
          console.error(`Failed to download ${fn}:`, err);
        }
      }

      setDeviceFiles(files);
      const tracks = await loadTracks();
      setAppTracks(tracks);
      setMergedTracks(buildMergedTrackList(tracks, files));
      setView("tracks");
    } catch (err) {
      console.error("Track sync failed:", err);
      toast.error("Failed to sync tracks from device");
      setView("tracks");
    }
  }, [connection]);

  useEffect(() => {
    syncAll();
  }, [syncAll]);

  // ── Upload track to device ──
  const handleUploadToDevice = async (entry: MergedTrackEntry) => {
    if (!entry.appTrack) return;
    setUploading(entry.shortName);
    try {
      const json = buildTrackJsonForUpload(entry.appTrack);
      const data = new TextEncoder().encode(json);
      await uploadTrackFile(connection, entry.shortName + ".json", data);
      toast.success(`Uploaded ${entry.shortName} to device`);
      await syncAll();
    } catch (err: any) {
      toast.error(`Upload failed: ${err?.message || "Unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  // ── Save device track to app ──
  const handleSaveToApp = async (entry: MergedTrackEntry) => {
    try {
      // Use shortName as track name since we don't map to long names
      const trackName = entry.shortName;
      for (const dc of entry.deviceCourses) {
        const course = deviceCourseToAppCourse(dc);
        await addCourse(trackName, course);
      }
      // Also create the track entry with shortName
      await addTrack(trackName);
      toast.success(`Saved ${trackName} to local tracks`);
      // Re-merge
      const tracks = await loadTracks();
      setAppTracks(tracks);
      setMergedTracks(buildMergedTrackList(tracks, deviceFiles));
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message || "Unknown error"}`);
    }
  };

  // ── Upload single course (rebuilds full track JSON) ──
  const handleUploadCourse = async (trackEntry: MergedTrackEntry, courseName: string, source: 'app' | 'device') => {
    // Build the merged course list: take all device courses, replace/add the one from app (or vice versa)
    const allDeviceCourses = [...trackEntry.deviceCourses];
    let courseToUpload: DeviceCourseJson;

    if (source === 'app') {
      const appCourse = trackEntry.appCourses.find(c => c.name === courseName);
      if (!appCourse) return;
      courseToUpload = appCourseToDeviceJson(appCourse);
    } else {
      const dc = trackEntry.deviceCourses.find(c => c.name === courseName);
      if (!dc) return;
      courseToUpload = dc;
    }

    // Replace existing or add
    const idx = allDeviceCourses.findIndex(c => c.name === courseName);
    if (idx >= 0) {
      allDeviceCourses[idx] = courseToUpload;
    } else {
      allDeviceCourses.push(courseToUpload);
    }

    setUploading(trackEntry.shortName);
    try {
      const json = JSON.stringify(allDeviceCourses, null, '\t');
      const data = new TextEncoder().encode(json);
      await uploadTrackFile(connection, trackEntry.shortName + ".json", data);
      toast.success(`Updated ${trackEntry.shortName} on device`);
      setDiffCourse(null);
      await syncAll();
    } catch (err: any) {
      toast.error(`Upload failed: ${err?.message || "Unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  // ── Save single device course to app ──
  const handleSaveCourseToApp = async (trackEntry: MergedTrackEntry, dc: DeviceCourseJson) => {
    try {
      const trackName = trackEntry.trackName || trackEntry.shortName;
      const course = deviceCourseToAppCourse(dc);
      await addCourse(trackName, course);
      toast.success(`Saved course "${dc.name}" locally`);
      setDiffCourse(null);
      const tracks = await loadTracks();
      setAppTracks(tracks);
      setMergedTracks(buildMergedTrackList(tracks, deviceFiles));
      // Update selected track view
      const updated = buildMergedTrackList(tracks, deviceFiles).find(t => t.shortName === trackEntry.shortName);
      if (updated) setSelectedTrack(updated);
    } catch (err: any) {
      toast.error(`Save failed: ${err?.message || "Unknown error"}`);
    }
  };

  // ── Status icon helper ──
  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'synced': return <Check className="w-4 h-4 text-green-500 shrink-0" />;
      case 'mismatch': return <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />;
      case 'device_only': return <HelpCircle className="w-4 h-4 text-orange-500 shrink-0" />;
      case 'app_only': return <CloudOff className="w-4 h-4 text-blue-500 shrink-0" />;
      default: return null;
    }
  };

  // ─────────── LOADING VIEW ───────────
  if (view === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <h3 className="font-semibold text-foreground">Syncing Track Data</h3>
        <p className="text-sm text-muted-foreground">{loadProgress.label}</p>
        {loadProgress.total > 0 && (
          <p className="text-xs text-muted-foreground">
            {loadProgress.current} / {loadProgress.total} files
          </p>
        )}
      </div>
    );
  }

  // ─────────── COURSE LIST VIEW ───────────
  if (view === "courses" && selectedTrack) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setView("tracks"); setSelectedTrack(null); }}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <StatusIcon status={selectedTrack.status} />
          <span className="font-medium text-sm text-foreground truncate">{selectedTrack.shortName}</span>
          {selectedTrack.trackName && selectedTrack.trackName !== selectedTrack.shortName && (
            <span className="text-xs text-muted-foreground truncate">({selectedTrack.trackName})</span>
          )}
        </div>

        {/* Course list */}
        <div className="flex-1 overflow-y-auto">
          {selectedTrack.mergedCourses.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No courses</div>
          ) : (
            selectedTrack.mergedCourses.map((mc) => (
              <div
                key={mc.name}
                className="flex items-center gap-2 px-3 py-2.5 border-b border-border hover:bg-muted/30 transition-colors"
              >
                <StatusIcon status={mc.status} />
                <span className="flex-1 text-sm text-foreground truncate">{mc.name}</span>

                {mc.status === 'app_only' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    disabled={uploading === selectedTrack.shortName}
                    onClick={() => handleUploadCourse(selectedTrack, mc.name, 'app')}
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </Button>
                )}
                {mc.status === 'device_only' && mc.deviceCourse && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => handleSaveCourseToApp(selectedTrack, mc.deviceCourse!)}
                  >
                    <Download className="w-3.5 h-3.5" /> Save
                  </Button>
                )}
                {mc.status === 'mismatch' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => setDiffCourse(mc)}
                  >
                    <GitCompare className="w-3.5 h-3.5" /> Compare
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Diff Modal */}
        {diffCourse && diffCourse.appCourse && diffCourse.deviceCourse && (
          <CourseDiffDialog
            courseName={diffCourse.name}
            appCourse={diffCourse.appCourse}
            deviceCourse={diffCourse.deviceCourse}
            uploading={uploading === selectedTrack.shortName}
            onDownloadToDevice={() => handleUploadCourse(selectedTrack, diffCourse.name, 'app')}
            onUploadToApp={() => handleSaveCourseToApp(selectedTrack, diffCourse.deviceCourse!)}
            onClose={() => setDiffCourse(null)}
          />
        )}
      </div>
    );
  }

  // ─────────── TRACK LIST VIEW ───────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {mergedTracks.length} track{mergedTracks.length !== 1 ? 's' : ''}
        </span>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={syncAll}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto">
        {mergedTracks.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No tracks found on device or in app.
          </div>
        ) : (
          mergedTracks.map((entry) => (
            <div
              key={entry.shortName}
              className="flex items-center gap-2 px-3 py-2.5 border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => { setSelectedTrack(entry); setView("courses"); }}
            >
              <StatusIcon status={entry.status} />
              <span className="flex-1 text-sm font-medium text-foreground truncate">
                {entry.shortName}
              </span>
              {entry.trackName && entry.trackName !== entry.shortName && (
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                  {entry.trackName}
                </span>
              )}

              {/* Action buttons — stop propagation so click doesn't drill into courses */}
              {entry.status === 'app_only' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 shrink-0"
                  disabled={uploading === entry.shortName}
                  onClick={(e) => { e.stopPropagation(); handleUploadToDevice(entry); }}
                >
                  {uploading === entry.shortName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Upload
                </Button>
              )}
              {entry.status === 'device_only' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 shrink-0"
                  onClick={(e) => { e.stopPropagation(); handleSaveToApp(entry); }}
                >
                  <Download className="w-3.5 h-3.5" /> Save
                </Button>
              )}
              {entry.status === 'mismatch' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 shrink-0"
                  onClick={(e) => { e.stopPropagation(); setSelectedTrack(entry); setView("courses"); }}
                >
                  <GitCompare className="w-3.5 h-3.5" /> Courses
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Diff Dialog ──────────────────────────────────────────────────────────────

interface CourseDiffDialogProps {
  courseName: string;
  appCourse: import("@/types/racing").Course;
  deviceCourse: DeviceCourseJson;
  uploading: boolean;
  onDownloadToDevice: () => void;
  onUploadToApp: () => void;
  onClose: () => void;
}

function CourseDiffDialog({
  courseName,
  appCourse,
  deviceCourse,
  uploading,
  onDownloadToDevice,
  onUploadToApp,
  onClose,
}: CourseDiffDialogProps) {
  const appSectors = countAppSectors(appCourse);
  const deviceSectors = countDeviceSectors(deviceCourse);
  const distance = startADistance(appCourse, deviceCourse);

  const formatCoord = (v: number) => v.toFixed(8);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            Course Mismatch — {courseName}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-xs">
          {/* Column headers */}
          <div className="font-semibold text-foreground text-center border-b border-border pb-1">On Server</div>
          <div className="font-semibold text-foreground text-center border-b border-border pb-1">On Logger</div>

          {/* Start A */}
          <DiffRow label="Start A Lat" left={formatCoord(appCourse.startFinishA.lat)} right={formatCoord(deviceCourse.start_a_lat)} />
          <DiffRow label="Start A Lng" left={formatCoord(appCourse.startFinishA.lon)} right={formatCoord(deviceCourse.start_a_lng)} />

          {/* Start B */}
          <DiffRow label="Start B Lat" left={formatCoord(appCourse.startFinishB.lat)} right={formatCoord(deviceCourse.start_b_lat)} />
          <DiffRow label="Start B Lng" left={formatCoord(appCourse.startFinishB.lon)} right={formatCoord(deviceCourse.start_b_lng)} />

          {/* Sectors */}
          <div className="col-span-2 grid grid-cols-2 gap-3 border-t border-border pt-2 mt-1">
            <div className="text-center text-muted-foreground">
              Sectors: <span className="text-foreground font-medium">{appSectors || "None"}</span>
            </div>
            <div className="text-center text-muted-foreground">
              Sectors: <span className="text-foreground font-medium">{deviceSectors || "None"}</span>
            </div>
          </div>

          {/* Distance */}
          <div className="col-span-2 text-center border-t border-border pt-2 mt-1 text-muted-foreground">
            Start line distance: <span className="text-foreground font-medium">{distance.toFixed(2)}m</span>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1"
            disabled={uploading}
            onClick={onDownloadToDevice}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Send to Logger
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1"
            onClick={onUploadToApp}
          >
            <Upload className="w-3.5 h-3.5" />
            Save from Logger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small helper for diff rows ──
function DiffRow({ label, left, right }: { label: string; left: string; right: string }) {
  const matches = left === right;
  return (
    <>
      <div className={`text-center font-mono ${matches ? 'text-muted-foreground' : 'text-foreground'}`}>{left}</div>
      <div className={`text-center font-mono ${matches ? 'text-muted-foreground' : 'text-foreground'}`}>{right}</div>
    </>
  );
}
