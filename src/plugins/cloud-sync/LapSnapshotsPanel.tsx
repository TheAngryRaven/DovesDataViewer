import { useCallback, useEffect, useState } from "react";
import { Camera, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { formatLapTime } from "@/lib/lapCalculation";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import { deleteSnapshot, listSnapshots } from "@/lib/lapSnapshotStorage";
import { deleteCloudSnapshot, listCloudSnapshots, reconcileSnapshots } from "./snapshotSync";

function formatDate(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Profile-tab panel for lap snapshots. Signed in: manage the snapshots stored in
// YOUR cloud (delete removes the cloud copy; local copies on devices are kept).
// Signed out: manage the snapshots saved on THIS device — the only thing you can
// do with them until you sign in to sync.
export default function LapSnapshotsPanel(_props: PluginPanelProps) {
  const { user, loading } = useAuth();
  const { tiers, currentTier } = useSubscription();
  const [items, setItems] = useState<LapSnapshot[] | null>(null);
  const [localIds, setLocalIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [alsoLocal, setAlsoLocal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const local = await listSnapshots();
      setLocalIds(new Set(local.map((s) => s.id)));
      if (user) {
        const cloud = await listCloudSnapshots(user.id);
        setItems(cloud.map((c) => c.data));
      } else {
        setItems(local);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load snapshots");
    }
  }, [user]);

  // Used + limit derived client-side from the cloud list + tier catalogue (the
  // snapshot_usage RPC has been flaky in production schema caches).
  const snapshotLimit = tiers.find((t) => t.tier === currentTier)?.snapshot_count ?? null;

  // Auto-detect local-only snapshots and upload them when signed in (the same
  // reconcile autoSync runs on sign-in, re-triggered here so opening the panel
  // self-heals a sign-in reconcile that failed — e.g. a transient outage —
  // without needing an app reload), then load the list. Re-runs whenever the
  // snapshot store changes (local saves, cloud pulls).
  const syncAndRefresh = useCallback(async () => {
    if (user) {
      // Failures (network/quota) are surfaced by autoSync's own toast + the
      // list/usage read below; don't double-notify from here.
      try {
        await reconcileSnapshots(user.id);
      } catch {
        /* fall through to refresh, which shows the current cloud state */
      }
    }
    await refresh();
  }, [user, refresh]);

  useEffect(() => {
    void syncAndRefresh();
    return onGarageChange((change) => {
      if (change.store === STORE_NAMES.LAP_SNAPSHOTS) void syncAndRefresh();
    });
  }, [syncAndRefresh]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const startConfirm = (id: string) => {
    setConfirming(id);
    setAlsoLocal(false);
  };

  const handleDelete = async (snap: LapSnapshot) => {
    setBusy(snap.id);
    try {
      if (user) {
        await deleteCloudSnapshot(user.id, snap);
        if (alsoLocal && localIds.has(snap.id)) await deleteSnapshot(snap.id);
        toast.success(
          alsoLocal && localIds.has(snap.id)
            ? "Deleted snapshot from the cloud and this device."
            : "Deleted snapshot from the cloud.",
        );
      } else {
        await deleteSnapshot(snap.id);
        toast.success("Deleted snapshot from this device.");
      }
      setConfirming(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  const handleSyncLocal = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const { pushed, skipped } = await reconcileSnapshots(user.id);
      if (skipped > 0) toast.error(`${skipped} snapshot${skipped === 1 ? "" : "s"} didn't fit your plan's limit.`);
      else if (pushed > 0) toast.success(`Synced ${pushed} snapshot${pushed === 1 ? "" : "s"}.`);
      else toast("Everything is already synced.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!items) return <p className="text-xs text-muted-foreground">Loading snapshots…</p>;

  const unsyncedLocal = user ? localIds.size > items.length : false;

  return (
    <div className="space-y-2">
      {user ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {snapshotLimit !== null
              ? `${items.length} of ${snapshotLimit} synced`
              : "Synced snapshots"}
          </p>
          {unsyncedLocal && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={syncing} onClick={() => void handleSyncLocal()}>
              {syncing ? "Syncing…" : "Sync local snapshots"}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          On this device. Sign in to sync snapshots across devices.
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {user ? "No snapshots in your cloud yet." : "No snapshots saved on this device yet."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((snap) => {
            const isConfirming = confirming === snap.id;
            const onDevice = localIds.has(snap.id);
            return (
              <div key={snap.id} className="rounded-md border border-border">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {snap.engine || "Unknown engine"}
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                        {formatLapTime(snap.lapTimeMs)}
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {snap.trackName} — {snap.courseName}
                      {formatDate(snap.recordedAt ?? snap.createdAt) && ` · ${formatDate(snap.recordedAt ?? snap.createdAt)}`}
                      {user && onDevice && " · on this device"}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    disabled={busy === snap.id}
                    onClick={() => startConfirm(snap.id)}
                    aria-label="Delete snapshot"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {isConfirming && (
                  <div className="space-y-2 border-t border-destructive/30 bg-destructive/5 px-3 py-2.5">
                    <p className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {user
                          ? "Permanently delete the cloud copy? This can't be undone."
                          : "Delete this snapshot from this device? This can't be undone."}
                      </span>
                    </p>
                    {user && onDevice && (
                      <div className="flex items-center gap-2">
                        <Switch id={`local-${snap.id}`} checked={alsoLocal} onCheckedChange={setAlsoLocal} disabled={busy === snap.id} />
                        <Label htmlFor={`local-${snap.id}`} className="text-xs text-muted-foreground">
                          Also delete the local copy on this device
                        </Label>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === snap.id} onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={busy === snap.id} onClick={() => void handleDelete(snap)}>
                        {busy === snap.id ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
