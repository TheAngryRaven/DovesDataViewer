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
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { BleConnection, requestTrackFileList, downloadTrackFile, uploadTrackFile, deleteTrackFile } from "@/lib/bleDatalogger";
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

  // Confirmation dialogs
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'track' | 'course'; trackEntry: MergedTrackEntry; courseName?: string } | null>(null);
  const [resyncConfirm, setResyncConfirm] = useState(false);
  const [resyncProgress, setResyncProgress] = useState<{ current: number; total: number; label: string } | null>(null);

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

  // ── helpers to check if track exists on device ──
  const isOnDevice = (entry: MergedTrackEntry) =>
    entry.status === 'synced' || entry.status === 'mismatch' || entry.status === 'device_only';

  const isCourseOnDevice = (mc: MergedCourseEntry) =>
    mc.status === 'synced' || mc.status === 'mismatch' || mc.status === 'device_only';

  // ── Send track to device ──
  const handleSendToDevice = async (entry: MergedTrackEntry) => {
    if (!entry.appTrack) return;
    setUploading(entry.shortName);
    try {
      const json = buildTrackJsonForUpload(entry.appTrack);
      const data = new TextEncoder().encode(json);
      await uploadTrackFile(connection, entry.shortName + ".json", data);
      toast.success(`Sent ${entry.shortName} to device`);
      await syncAll();
    } catch (err: any) {
      toast.error(`Send failed: ${err?.message || "Unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  // ── Download device track to app ──
  const handleDownloadToApp = async (entry: MergedTrackEntry) => {
    try {
      const trackName = entry.shortName;
      for (const dc of entry.deviceCourses) {
        const course = deviceCourseToAppCourse(dc);
        await addCourse(trackName, course);
      }
      await addTrack(trackName);
      toast.success(`Downloaded ${trackName} to app`);
      const tracks = await loadTracks();
      setAppTracks(tracks);
      setMergedTracks(buildMergedTrackList(tracks, deviceFiles));
    } catch (err: any) {
      toast.error(`Download failed: ${err?.message || "Unknown error"}`);
    }
  };

  // ── Delete track from device ──
  const handleDeleteTrackFromDevice = async (entry: MergedTrackEntry) => {
    setUploading(entry.shortName);
    try {
      await deleteTrackFile(connection, entry.shortName + ".json");
      toast.success(`Deleted ${entry.shortName} from device`);
      setDeleteConfirm(null);
      await syncAll();
    } catch (err: any) {
      toast.error(`Delete failed: ${err?.message || "Unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  // ── Delete single course from device (rebuild JSON without it) ──
  const handleDeleteCourseFromDevice = async (trackEntry: MergedTrackEntry, courseName: string) => {
    const remaining = trackEntry.deviceCourses.filter(c => c.name !== courseName);
    setUploading(trackEntry.shortName);
    try {
      if (remaining.length === 0) {
        // No courses left, delete the whole file
        await deleteTrackFile(connection, trackEntry.shortName + ".json");
        toast.success(`Deleted ${trackEntry.shortName} from device (no courses remaining)`);
      } else {
        // Re-upload without the deleted course
        const json = JSON.stringify(remaining, null, '\t');
        const data = new TextEncoder().encode(json);
        await uploadTrackFile(connection, trackEntry.shortName + ".json", data);
        toast.success(`Removed course "${courseName}" from device`);
      }
      setDeleteConfirm(null);
      await syncAll();
    } catch (err: any) {
      toast.error(`Delete failed: ${err?.message || "Unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  // ── Send single course to device (rebuilds full track JSON) ──
  const handleSendCourseToDevice = async (trackEntry: MergedTrackEntry, courseName: string, source: 'app' | 'device') => {
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
      toast.success(`Sent course "${courseName}" to device`);
      setDiffCourse(null);
      await syncAll();
    } catch (err: any) {
      toast.error(`Send failed: ${err?.message || "Unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  // ── Download single device course to app ──
  const handleDownloadCourseToApp = async (trackEntry: MergedTrackEntry, dc: DeviceCourseJson) => {
    try {
      const trackName = trackEntry.trackName || trackEntry.shortName;
      const course = deviceCourseToAppCourse(dc);
      await addCourse(trackName, course);
      toast.success(`Downloaded course "${dc.name}" to app`);
      setDiffCourse(null);
      const tracks = await loadTracks();
      setAppTracks(tracks);
      setMergedTracks(buildMergedTrackList(tracks, deviceFiles));
      const updated = buildMergedTrackList(tracks, deviceFiles).find(t => t.shortName === trackEntry.shortName);
      if (updated) setSelectedTrack(updated);
    } catch (err: any) {
      toast.error(`Download failed: ${err?.message || "Unknown error"}`);
    }
  };

  // ── Resync all tracks ──
  const handleResyncAll = async () => {
    setResyncConfirm(false);
    const toSync = mergedTracks.filter(t => t.appTrack); // Only tracks we know about in app
    if (toSync.length === 0) {
      toast.info("No app tracks to sync");
      return;
    }

    setResyncProgress({ current: 0, total: toSync.length, label: "Starting…" });
    setView("loading");

    for (let i = 0; i < toSync.length; i++) {
      const entry = toSync[i];
      setResyncProgress({ current: i + 1, total: toSync.length, label: entry.shortName });

      try {
        // Delete from device if it exists there
        if (isOnDevice(entry)) {
          await deleteTrackFile(connection, entry.shortName + ".json");
        }
        // Upload from app
        const json = buildTrackJsonForUpload(entry.appTrack!);
        const data = new TextEncoder().encode(json);
        await uploadTrackFile(connection, entry.shortName + ".json", data);
      } catch (err: any) {
        console.error(`Resync failed for ${entry.shortName}:`, err);
        toast.error(`Failed to sync ${entry.shortName}: ${err?.message || "Unknown"}`);
      }
    }

    setResyncProgress(null);
    toast.success(`Resynced ${toSync.length} track(s) to device`);
    await syncAll();
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
    const progress = resyncProgress || loadProgress;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-3 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <h3 className="font-semibold text-foreground">{resyncProgress ? "Resyncing Tracks" : "Syncing Track Data"}</h3>
        <p className="text-sm text-muted-foreground">{progress.label}</p>
        {progress.total > 0 && (
          <p className="text-xs text-muted-foreground">
            {progress.current} / {progress.total} {resyncProgress ? "tracks" : "files"}
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
                    onClick={() => handleSendCourseToDevice(selectedTrack, mc.name, 'app')}
                  >
                    <Upload className="w-3.5 h-3.5" /> Send
                  </Button>
                )}
                {mc.status === 'device_only' && mc.deviceCourse && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => handleDownloadCourseToApp(selectedTrack, mc.deviceCourse!)}
                    >
                      <Download className="w-3.5 h-3.5" /> Get
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm({ type: 'course', trackEntry: selectedTrack, courseName: mc.name })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
                {mc.status === 'mismatch' && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => setDiffCourse(mc)}
                    >
                      <GitCompare className="w-3.5 h-3.5" /> Compare
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm({ type: 'course', trackEntry: selectedTrack, courseName: mc.name })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
                {mc.status === 'synced' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirm({ type: 'course', trackEntry: selectedTrack, courseName: mc.name })}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
            onSendToDevice={() => handleSendCourseToDevice(selectedTrack, diffCourse.name, 'app')}
            onDownloadToApp={() => handleDownloadCourseToApp(selectedTrack, diffCourse.deviceCourse!)}
            onClose={() => setDiffCourse(null)}
          />
        )}

        {/* Delete confirmation */}
        {deleteConfirm && (
          <ConfirmDeleteDialog
            title={deleteConfirm.type === 'track'
              ? `Delete ${deleteConfirm.trackEntry.shortName} from device?`
              : `Delete course "${deleteConfirm.courseName}" from ${deleteConfirm.trackEntry.shortName} on device?`}
            description={deleteConfirm.type === 'course'
              ? "The track will be re-uploaded without this course. If no courses remain, the entire track file will be deleted."
              : "This will remove the track file from the device's SD card."}
            loading={uploading === deleteConfirm.trackEntry.shortName}
            onConfirm={() => {
              if (deleteConfirm.type === 'track') {
                handleDeleteTrackFromDevice(deleteConfirm.trackEntry);
              } else {
                handleDeleteCourseFromDevice(deleteConfirm.trackEntry, deleteConfirm.courseName!);
              }
            }}
            onClose={() => setDeleteConfirm(null)}
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
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setResyncConfirm(true)}>
            <RotateCcw className="w-3.5 h-3.5" /> Resync All
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={syncAll}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
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
                  onClick={(e) => { e.stopPropagation(); handleSendToDevice(entry); }}
                >
                  {uploading === entry.shortName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Send
                </Button>
              )}
              {entry.status === 'device_only' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleDownloadToApp(entry); }}
                  >
                    <Download className="w-3.5 h-3.5" /> Get
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 shrink-0 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: 'track', trackEntry: entry }); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
              {(entry.status === 'synced' || entry.status === 'mismatch') && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 shrink-0 text-destructive hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: 'track', trackEntry: entry }); }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
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

      {/* Delete confirmation */}
      {deleteConfirm && (
        <ConfirmDeleteDialog
          title={`Delete ${deleteConfirm.trackEntry.shortName} from device?`}
          description="This will remove the track file from the device's SD card."
          loading={uploading === deleteConfirm.trackEntry.shortName}
          onConfirm={() => handleDeleteTrackFromDevice(deleteConfirm.trackEntry)}
          onClose={() => setDeleteConfirm(null)}
        />
      )}

      {/* Resync confirmation */}
      {resyncConfirm && (
        <ConfirmDeleteDialog
          title="Resync All Tracks to Device?"
          description="This will delete all known tracks from the device and re-upload them from the app. Device-only tracks will be left untouched."
          confirmLabel="Resync"
          loading={false}
          onConfirm={handleResyncAll}
          onClose={() => setResyncConfirm(false)}
        />
      )}
    </div>
  );
}

// ─── Confirm Delete Dialog ────────────────────────────────────────────────────

interface ConfirmDeleteDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function ConfirmDeleteDialog({ title, description, confirmLabel = "Delete", loading, onConfirm, onClose }: ConfirmDeleteDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={loading} className="gap-1">
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diff Dialog ──────────────────────────────────────────────────────────────

interface CourseDiffDialogProps {
  courseName: string;
  appCourse: import("@/types/racing").Course;
  deviceCourse: DeviceCourseJson;
  uploading: boolean;
  onSendToDevice: () => void;
  onDownloadToApp: () => void;
  onClose: () => void;
}

function CourseDiffDialog({
  courseName,
  appCourse,
  deviceCourse,
  uploading,
  onSendToDevice,
  onDownloadToApp,
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
          <div className="font-semibold text-foreground text-center border-b border-border pb-1">In App</div>
          <div className="font-semibold text-foreground text-center border-b border-border pb-1">On Device</div>

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
            onClick={onSendToDevice}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Send to Device
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1"
            onClick={onDownloadToApp}
          >
            <Download className="w-3.5 h-3.5" />
            Download to App
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
