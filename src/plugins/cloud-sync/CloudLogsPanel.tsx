import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, AlertTriangle, CloudDownload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { deleteFile, listAllMetadata, listFiles, saveFile, type FileEntry, type FileMetadata } from "@/lib/fileStorage";
import { listVehicles, type Vehicle } from "@/lib/vehicleStorage";
import {
  buildBrowserSessions, computeBrowserView, ROOT_NAV,
  type BrowserSession, type NavState,
} from "@/lib/fileBrowserTree";
import { SessionBrowser } from "@/components/SessionBrowser";
import { cleanupOrphanBlobs, deleteCloudFile, downloadCloudFile, listCloudFiles, type CloudFile } from "./syncEngine";
import { cloudOnlyNames, markPushed, unselectFile } from "./fileSync";
import { formatBytes } from "./storageTypes";

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Profile-tab panel: manage the log files stored in YOUR cloud, in the same
// Track→Course folder browser as the file manager. Deleting removes the cloud
// copy only (other devices keep what they've downloaded); an opt-in toggle also
// removes the local copy. "Download all" pulls every cloud log not on this device.
export default function CloudLogsPanel(_props: PluginPanelProps) {
  const { user, loading } = useAuth();
  const online = useOnlineStatus();
  const [cloud, setCloud] = useState<CloudFile[] | null>(null);
  const [localFiles, setLocalFiles] = useState<FileEntry[]>([]);
  const [metaMap, setMetaMap] = useState<Map<string, FileMetadata>>(new Map());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<NavState>(ROOT_NAV);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [alsoLocal, setAlsoLocal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [cloudFiles, local, metas, vehs] = await Promise.all([
        listCloudFiles(user.id), listFiles(), listAllMetadata(), listVehicles(),
      ]);
      setCloud(cloudFiles);
      setLocalFiles(local);
      setMetaMap(new Map(metas.map((m) => [m.fileName, m])));
      setVehicles(vehs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cloud files");
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reclaim any orphaned blobs (no index row) once per signed-in user.
  const cleanedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || cleanedFor.current === user.id) return;
    cleanedFor.current = user.id;
    void cleanupOrphanBlobs(user.id).then((n) => {
      if (n > 0) void refresh();
    });
  }, [user, refresh]);

  const cloudByName = useMemo(() => new Map((cloud ?? []).map((c) => [c.name, c])), [cloud]);

  // All cloud logs, grouped Track→Course: those also on this device are "local"
  // rows; cloud-only ones are "cloud" rows.
  const sessions = useMemo(() => {
    const cloudNames = new Set((cloud ?? []).map((c) => c.name));
    const localOfCloud = localFiles.filter((f) => cloudNames.has(f.name));
    const remoteOnly = (cloud ?? [])
      .filter((c) => !localFiles.some((f) => f.name === c.name))
      .map((c) => ({ name: c.name, size: c.size, uploadedAt: c.uploadedAt }));
    return buildBrowserSessions(localOfCloud, metaMap, vehicles, remoteOnly);
  }, [cloud, localFiles, metaMap, vehicles]);

  const view = useMemo(() => computeBrowserView(sessions, nav), [sessions, nav]);

  const handleDelete = useCallback(async (name: string) => {
    if (!user) return;
    const removeLocal = alsoLocal && localFiles.some((f) => f.name === name);
    setBusy(name);
    try {
      await deleteCloudFile(user.id, name);
      await unselectFile(name);
      if (removeLocal) await deleteFile(name);
      toast.success(removeLocal
        ? `Deleted "${name}" from the cloud and this device.`
        : `Deleted "${name}" from the cloud.`);
      setConfirming(null);
      setAlsoLocal(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }, [user, alsoLocal, localFiles, refresh]);

  const downloadAll = useCallback(async () => {
    if (!user || downloading) return;
    const pending = cloudOnlyNames((cloud ?? []).map((c) => c.name), localFiles.map((f) => f.name));
    if (pending.length === 0) {
      toast("All cloud logs are already on this device.");
      return;
    }
    setDownloading({ done: 0, total: pending.length });
    let ok = 0; let failed = 0;
    for (const name of pending) {
      try {
        const blob = await downloadCloudFile(user.id, name);
        if (!blob) throw new Error("no data");
        await saveFile(name, blob);
        await markPushed(name);
        ok++;
      } catch {
        failed++;
      }
      setDownloading({ done: ok + failed, total: pending.length });
    }
    setDownloading(null);
    if (failed) toast.error(`Downloaded ${ok} log${ok === 1 ? "" : "s"}; ${failed} failed.`);
    else toast.success(`Downloaded ${ok} cloud log${ok === 1 ? "" : "s"} to this device.`);
    await refresh();
  }, [user, downloading, cloud, localFiles, refresh]);

  const renderRow = useCallback((s: BrowserSession) => {
    const cf = cloudByName.get(s.fileName);
    const onDevice = s.location === "local";
    const isConfirming = confirming === s.fileName;
    return (
      <div className="rounded-md border border-border">
        {/* Cloud-only rows are greyed out (not on this device until downloaded). */}
        <div className={`flex items-center gap-2 px-3 py-2${onDevice ? "" : " opacity-60"}`}>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm ${onDevice ? "text-foreground" : "text-muted-foreground"}`} title={s.fileName}>{s.displayName}</p>
            <p className="text-[11px] text-muted-foreground">
              {formatDate(cf?.uploadedAt)}
              {cf?.size != null && ` · ${formatBytes(cf.size)}`}
              {onDevice ? " · on this device" : " · cloud only"}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
            disabled={busy === s.fileName}
            onClick={() => { setConfirming(s.fileName); setAlsoLocal(false); }}
            aria-label={`Delete ${s.fileName} from cloud`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {isConfirming && (
          <div className="space-y-2 border-t border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Permanently delete the <strong>cloud copy</strong>? This can't be undone.</span>
            </p>
            {onDevice && (
              <div className="flex items-center gap-2">
                <Switch id={`local-${s.fileName}`} checked={alsoLocal} onCheckedChange={setAlsoLocal} disabled={busy === s.fileName} />
                <Label htmlFor={`local-${s.fileName}`} className="text-xs text-muted-foreground">
                  Also delete the local file from this device (other devices keep their copy)
                </Label>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === s.fileName} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={busy === s.fileName} onClick={() => void handleDelete(s.fileName)}>
                {busy === s.fileName ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }, [cloudByName, confirming, alsoLocal, busy, handleDelete]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!user) {
    return (
      <p className="text-xs text-muted-foreground">
        Sign in to manage the log files stored in your cloud.
      </p>
    );
  }
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!cloud) return <p className="text-xs text-muted-foreground">Loading cloud files…</p>;
  if (cloud.length === 0) {
    return <p className="text-xs text-muted-foreground">No log files in your cloud yet.</p>;
  }

  const pendingCount = cloudOnlyNames(cloud.map((c) => c.name), localFiles.map((f) => f.name)).length;

  return (
    <div className="space-y-2">
      {pendingCount > 0 && (
        <Button variant="outline" className="w-full" onClick={() => void downloadAll()} disabled={!!downloading || !online}>
          {downloading
            ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            : <CloudDownload className="w-4 h-4 mr-2" />}
          {downloading
            ? `Downloading ${downloading.done}/${downloading.total}…`
            : `Download all cloud logs (${pendingCount})`}
        </Button>
      )}
      {!online && (
        <p className="text-xs text-muted-foreground text-center">You're offline.</p>
      )}
      <SessionBrowser view={view} onNavigate={setNav} renderRow={renderRow} emptyText="No cloud logs here" />
    </div>
  );
}
