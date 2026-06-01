import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Check, CloudOff, CreditCard, Loader2, LogOut, Pencil, RefreshCw,
  User as UserIcon, WifiOff, X,
} from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSubscription } from "@/hooks/useSubscription";
import { isPaidTier } from "@/lib/billing";
import { createPortal } from "@/lib/billingClient";
import { onGarageChange } from "@/lib/garageEvents";
import { getStorageUsage } from "./syncEngine";
import { getLocalStorageUsage } from "./localUsage";
import { getMyProfile, updateDisplayName } from "./profile";
import { pendingCount } from "./pendingSync";
import {
  formatBytes, segmentFractions, totalUsed, usageFraction,
  type StorageType, type StorageUsage,
} from "./storageTypes";

// The three segments of the one storage bar, in stacked order (logs first). Each
// draws from the same pooled per-tier limit; the dot + bar share a colour.
const SEGMENTS: { key: StorageType; label: string; color: string }[] = [
  { key: "logs", label: "Logs", color: "bg-primary" },
  { key: "snapshots", label: "Snapshots", color: "bg-amber-500" },
  { key: "documents", label: "Garage", color: "bg-emerald-500" },
];

// Google sign-in is gated separately: it currently routes through Lovable's OAuth
// broker, so it stays off until native Supabase Google OAuth is configured.
const enableGoogleAuth = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";

// Merged account + profile panel: your display name + (when signed in) sign-out,
// plan, and cloud storage usage; signed out it offers sign-in and still shows the
// storage bar measured against this device's local storage. Everything here works
// offline — the cloud is an optional backup, not a requirement.
export default function StoragePanel(_props: PluginPanelProps) {
  const { user, loading, logout } = useAuth();
  const online = useOnlineStatus();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  const refresh = useCallback(async () => {
    try {
      if (user) {
        setPending(await pendingCount());
        setUsage(await getStorageUsage());
      } else {
        setPending(0);
        setUsage(await getLocalStorageUsage());
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load storage usage");
    }
  }, [user]);

  // Re-read on mount and whenever connectivity flips (pending changes flush on
  // reconnect). Signed out, also track on-device garage changes live, so the
  // local meter reflects imports/deletes immediately; signed in, the server
  // usage updates post-sync, so the extra reads aren't worth the network cost.
  useEffect(() => {
    void refresh();
    if (user) return;
    return onGarageChange(() => void refresh());
  }, [refresh, online, user]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!user) {
    return (
      <div className="space-y-5">
        <SignInPrompt />
        <StorageSection usage={usage} error={error} local />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DisplayName
        userId={user.id}
        email={user.email ?? ""}
        action={
          <Button variant="ghost" size="sm" className="shrink-0 self-start text-muted-foreground" onClick={logout}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        }
      />

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

      <StorageSection usage={usage} error={error} local={false} />
    </div>
  );
}

// Sign-in entry point (moved here from the old Account panel): Google one-tap plus
// email sign-in / registration. Offline disables it with a hint.
function SignInPrompt() {
  const { signInWithGoogle } = useAuth();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setBusy(false);
      toast.error(error.message || "Google sign-in failed");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Sign in to back up and sync your files, garage and notes across devices.
        Everything here still works offline against this device — Cloud Sync is optional.
      </p>
      <div className="flex flex-col gap-2">
        {enableGoogleAuth && (
          <Button variant="outline" onClick={handleGoogle} disabled={busy || !online}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue with Google"}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="secondary"><Link to="/login?next=/">Sign in</Link></Button>
          <Button asChild><Link to="/register">Create account</Link></Button>
        </div>
      </div>
      {!online && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5" /> You're offline — sign-in needs a connection.
        </p>
      )}
    </div>
  );
}

function DisplayName({ userId, email, action }: { userId: string; email: string; action?: ReactNode }) {
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
    } else if (result.reason === "profanity") {
      toast.error("Please choose a cleaner display name.");
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
      {action}
    </div>
  );
}

function PlanSection() {
  const { tiers, currentTier, subscription, loading } = useSubscription();
  const [busy, setBusy] = useState<"manage" | "change" | null>(null);

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

  // Open the Stripe portal — generic (cancel / payment methods) or, with
  // flow "update", deep-linked into the change-plan screen.
  const openPortal = async (which: "manage" | "change") => {
    setBusy(which);
    try {
      const url = await createPortal(window.location.href, which === "change" ? "update" : undefined);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the billing portal.");
      setBusy(null);
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
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {/* Switching plans (storage tier / interval) is a separate, dedicated
                action from cancelling — both run through the Stripe portal, which
                swaps the plan on the existing subscription with proration. */}
            {subscribed && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!!busy}
                onClick={() => void openPortal("change")}
              >
                {busy === "change" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Change plan
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={!!busy}
              onClick={() => void openPortal("manage")}
            >
              {busy === "manage" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Manage subscription
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// The storage heading + bar, shared between the signed-in (cloud) and signed-out
// (local) views. `local` swaps the cloud-quota framing for an on-device one.
function StorageSection({
  usage, error, local,
}: { usage: StorageUsage | null; error: string | null; local: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Storage</p>
        <p className="text-[11px] text-muted-foreground">
          {local ? "Stored on this device." : "Local storage is always free."}
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!usage && !error && <p className="text-xs text-muted-foreground">Loading usage…</p>}
      {usage && <StorageBar usage={usage} local={local} />}
    </div>
  );
}

// One pooled byte budget, drawn as a single stacked bar: logs + snapshots + garage
// data share the limit (like a phone's storage screen). Segments are coloured; the
// empty remainder is muted. Over the limit, segments fill the whole bar and the
// readout turns destructive. `local` measures this device against the browser quota.
function StorageBar({ usage, local }: { usage: StorageUsage; local: boolean }) {
  const used = totalUsed(usage);
  const over = used > usage.totalLimit;
  const fractions = segmentFractions(usage);
  const pct = Math.round(usageFraction(used, usage.totalLimit) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{pct}% used</span>
        <span className={`text-xs tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
          {formatBytes(used)} / {formatBytes(usage.totalLimit)}
        </span>
      </div>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        {SEGMENTS.map((seg) => {
          const width = fractions[seg.key] * 100;
          if (width <= 0) return null;
          return <div key={seg.key} className={`h-full ${seg.color}`} style={{ width: `${width}%` }} />;
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SEGMENTS.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5 text-[11px]">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${seg.color}`} />
            <span className="text-foreground">{seg.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatBytes(usage[seg.key])}</span>
          </div>
        ))}
      </div>

      {local ? (
        <p className="text-[11px] text-muted-foreground">
          Measured against this device's storage. Sign in to back it up to the cloud.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Garage data and snapshots always sync, even when you're full — they still
          count toward your storage, but only logs stop syncing when the cap is reached.
        </p>
      )}

      {over && !local && (
        <p className="text-[11px] text-destructive">
          You're over your plan's storage. New cloud syncs are saved locally until you free up space or upgrade.
        </p>
      )}
    </div>
  );
}
