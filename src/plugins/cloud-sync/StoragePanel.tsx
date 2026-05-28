import { useCallback, useEffect, useState } from "react";
import { Check, CloudOff, CreditCard, Loader2, Pencil, User as UserIcon, X } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSubscription } from "@/hooks/useSubscription";
import { isPaidTier } from "@/lib/billing";
import { createPortal } from "@/lib/billingClient";
import { getStorageUsage } from "./syncEngine";
import { listCloudSnapshots } from "./snapshotSync";
import { getMyProfile, updateDisplayName } from "./profile";
import { pendingCount } from "./pendingSync";
import { formatBytes, usageFraction, type StorageTypeUsage } from "./storageTypes";

const TYPE_LABEL: Record<string, string> = { documents: "Documents", logs: "Logs" };
const TYPE_HINT: Record<string, string> = {
  documents: "Vehicles, setups, templates & notes — free, auto-synced.",
  logs: "Session log files you've chosen to sync.",
};

// Scratch-pad profile panel: your (editable, unique) display name + cloud storage
// usage against the document/log storage limits.
export default function StoragePanel(_props: PluginPanelProps) {
  const { user, loading } = useAuth();
  const online = useOnlineStatus();
  const { tiers, currentTier } = useSubscription();
  const [usage, setUsage] = useState<StorageTypeUsage[] | null>(null);
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    setPending(await pendingCount());
    try {
      setUsage(await getStorageUsage());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load storage usage");
    }
    // Snapshot count: derive client-side from the cloud list (the RPC has been
    // flaky in production schema caches). The limit comes from the tier
    // catalogue (snapshot_count). Best-effort — a failure must not hide the
    // documents/logs meters above.
    try {
      setSnapshotCount((await listCloudSnapshots(user.id)).length);
    } catch {
      setSnapshotCount(null);
    }
  }, [user]);

  const snapshotLimit = tiers.find((t) => t.tier === currentTier)?.snapshot_count ?? null;

  // Re-read on mount and whenever connectivity flips (pending changes flush on
  // reconnect, so the count + usage should refresh then).
  useEffect(() => {
    void refresh();
  }, [refresh, online]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!user) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Not signed in</p>
        <p className="text-xs text-muted-foreground">
          Sign in under Account (above) to back up your garage and see your storage usage.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DisplayName userId={user.id} email={user.email ?? ""} />

      <PlanSection />

      {!online && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            You're offline.{" "}
            {pending > 0
              ? `${pending} change${pending === 1 ? "" : "s"} saved locally — they'll sync when you reconnect.`
              : "Changes are saved locally and will sync when you reconnect."}
          </span>
        </div>
      )}
      {online && pending > 0 && (
        <p className="text-xs text-muted-foreground">
          Syncing {pending} pending change{pending === 1 ? "" : "s"}…
        </p>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Storage</p>
          <p className="text-[11px] text-muted-foreground">Local storage is always free.</p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!usage && !error && <p className="text-xs text-muted-foreground">Loading usage…</p>}
        {usage?.map((u) => (
          <Meter key={u.storageType} usage={u} />
        ))}
        {snapshotCount !== null && snapshotLimit !== null && (
          <CountMeter
            label="Lap snapshots"
            hint="Frozen course-fastest-lap captures."
            used={snapshotCount}
            limit={snapshotLimit}
          />
        )}
      </div>
    </div>
  );
}

function DisplayName({ userId, email }: { userId: string; email: string }) {
  const [name, setName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getMyProfile(userId)
      .then((p) => {
        if (!cancelled) setName(p?.display_name ?? null);
      })
      .catch(() => {
        if (!cancelled) setName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const startEdit = () => {
    setDraft(name ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    const result = await updateDisplayName(userId, draft);
    setSaving(false);
    if (result.ok) {
      setName(draft.trim());
      setEditing(false);
      toast.success("Display name updated.");
    } else if (result.reason === "taken") {
      toast.error("That name's taken — try another.");
    } else if (result.reason === "empty") {
      toast.error("Display name can't be empty.");
    } else {
      toast.error(result.message ?? "Couldn't update display name.");
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <UserIcon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={40}
              autoFocus
              disabled={saving}
              className="h-8"
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={saving} onClick={() => void save()}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={saving} onClick={() => setEditing(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground">{name ?? "…"}</p>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-muted-foreground" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <p className="truncate text-xs text-muted-foreground">{email}</p>
      </div>
    </div>
  );
}

function PlanSection() {
  const { tiers, currentTier, subscription, loading } = useSubscription();
  const [busy, setBusy] = useState(false);

  const label = tiers.find((t) => t.tier === currentTier)?.label
    ?? currentTier.charAt(0).toUpperCase() + currentTier.slice(1);
  const subscribed = isPaidTier(currentTier);
  const renews = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString()
    : null;
  const cancelsAtPeriodEnd = !!subscription?.cancel_at_period_end;
  // A cancelled subscription drops to free but keeps a grace window before logs
  // are trimmed; the row persists (with a Stripe customer) so they can resubscribe.
  const graceUntil = subscription?.grace_until
    ? new Date(subscription.grace_until).toLocaleDateString()
    : null;
  const inGrace = !subscribed && !!graceUntil;
  const canManage = !!subscription?.current_period_end || subscribed || inGrace;

  const manage = async () => {
    setBusy(true);
    try {
      const url = await createPortal(window.location.href);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the billing portal.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan</p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{loading ? "…" : label}</p>
          {subscribed && renews && (
            <p className="text-[11px] text-muted-foreground">
              {cancelsAtPeriodEnd ? `Cancels ${renews}` : `Renews ${renews}`}
            </p>
          )}
          {inGrace && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500">
              Subscription ended. Cloud logs trim to the free tier on {graceUntil} — resubscribe to keep them.
            </p>
          )}
          {!subscribed && !inGrace && (
            <p className="text-[11px] text-muted-foreground">Upgrade from the Plans &amp; pricing cards.</p>
          )}
        </div>
        {canManage && (
          <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={() => void manage()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Manage subscription
          </Button>
        )}
      </div>
    </div>
  );
}

function Meter({ usage }: { usage: StorageTypeUsage }) {
  const pct = Math.round(usageFraction(usage) * 100);
  const over = usage.usedBytes > usage.limitBytes;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{TYPE_LABEL[usage.storageType] ?? usage.storageType}</span>
        <span className={`text-xs tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
          {formatBytes(usage.usedBytes)} / {formatBytes(usage.limitBytes)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{TYPE_HINT[usage.storageType]}</p>
    </div>
  );
}

// Snapshots are a count-based quota (not bytes), so they need their own meter
// rather than the byte-aware one above.
function CountMeter({ label, hint, used, limit }: { label: string; hint: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = used > limit;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className={`text-xs tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
