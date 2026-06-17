import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import { isPaidTier, isComped, hasCompGrant, daysUntilTrim } from "@/lib/billing";
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
const SEGMENTS = [
  { key: "logs", labelKey: "storage.segments.logs", color: "bg-primary" },
  { key: "snapshots", labelKey: "storage.segments.snapshots", color: "bg-amber-500" },
  { key: "documents", labelKey: "storage.segments.garage", color: "bg-emerald-500" },
] as const satisfies { key: StorageType; labelKey: string; color: string }[];

// Google sign-in is gated separately: it currently routes through Lovable's OAuth
// broker, so it stays off until native Supabase Google OAuth is configured.
const enableGoogleAuth = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true";

// Merged account + profile panel: your display name + (when signed in) sign-out,
// plan, and cloud storage usage; signed out it offers sign-in and still shows the
// storage bar measured against this device's local storage. Everything here works
// offline — the cloud is an optional backup, not a requirement.
export default function StoragePanel(_props: PluginPanelProps) {
  const { t } = useTranslation("plugins");
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
      setError(e instanceof Error ? e.message : t("account.loadUsageFailed"));
    }
  }, [user, t]);

  // Re-read on mount and whenever connectivity flips (pending changes flush on
  // reconnect). Signed out, also track on-device garage changes live, so the
  // local meter reflects imports/deletes immediately; signed in, the server
  // usage updates post-sync, so the extra reads aren't worth the network cost.
  useEffect(() => {
    void refresh();
    if (user) return;
    return onGarageChange(() => void refresh());
  }, [refresh, online, user]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

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
            <LogOut className="mr-1.5 h-4 w-4" /> {t("account.signOut")}
          </Button>
        }
      />

      <PlanSection />

      {!online && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t("account.offline")}{" "}
            {pending > 0
              ? t("account.offlinePending", { count: pending })
              : t("account.offlineNoPending")}
          </span>
        </div>
      )}
      {online && pending > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("account.syncingPending", { count: pending })}
        </p>
      )}

      <StorageSection usage={usage} error={error} local={false} />
    </div>
  );
}

// Sign-in entry point (moved here from the old Account panel): Google one-tap plus
// email sign-in / registration. Offline disables it with a hint.
function SignInPrompt() {
  const { t } = useTranslation("plugins");
  const { signInWithGoogle } = useAuth();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => {
    setBusy(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setBusy(false);
      toast.error(error.message || t("account.googleSignInFailed"));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("account.signInBlurb")}
      </p>
      <div className="flex flex-col gap-2">
        {enableGoogleAuth && (
          <Button variant="outline" onClick={handleGoogle} disabled={busy || !online}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("account.continueWithGoogle")}
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="secondary"><Link to="/login?next=/">{t("account.signIn")}</Link></Button>
          <Button asChild><Link to="/register">{t("account.createAccount")}</Link></Button>
        </div>
      </div>
      {!online && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5" /> {t("account.offlineSignIn")}
        </p>
      )}
    </div>
  );
}

function DisplayName({ userId, email, action }: { userId: string; email: string; action?: ReactNode }) {
  const { t } = useTranslation("plugins");
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
      toast.success(t("account.nameUpdated"));
    } else if (result.reason === "taken") {
      toast.error(t("account.nameTaken"));
    } else if (result.reason === "empty") {
      toast.error(t("account.nameEmpty"));
    } else if (result.reason === "profanity") {
      toast.error(t("account.nameProfanity"));
    } else {
      toast.error(result.message ?? t("account.nameUpdateFailed"));
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
  const { t } = useTranslation("plugins");
  const { tiers, currentTier, subscription, loading } = useSubscription();
  const [busy, setBusy] = useState<"manage" | "change" | null>(null);

  const label = tiers.find((t) => t.tier === currentTier)?.label
    ?? currentTier.charAt(0).toUpperCase() + currentTier.slice(1);
  const subscribed = isPaidTier(currentTier);
  // An admin comp (complimentary plan) — a paid tier with no Stripe subscription
  // behind it. It has no billing portal to manage, so the comp note replaces the
  // renews/cancel line and the Stripe buttons are hidden.
  const comped = isComped(subscription);
  const renews = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString()
    : null;
  const cancelsAtPeriodEnd = !!subscription?.cancel_at_period_end;
  // A lapsed plan (cancelled Stripe sub OR expired comp) drops to free limits but
  // keeps a grace window before its over-limit logs are trimmed. Warn during it.
  const graceUntil = subscription?.grace_until
    ? new Date(subscription.grace_until).toLocaleDateString()
    : null;
  const inGrace = !subscribed && !!graceUntil;
  const trimDays = daysUntilTrim(subscription?.grace_until);
  // A comp (active or lapsed) has no Stripe customer, so the portal can't open.
  const canManage = !hasCompGrant(subscription) && (!!subscription?.current_period_end || subscribed || inGrace);

  // Open the Stripe portal — generic (cancel / payment methods) or, with
  // flow "update", deep-linked into the change-plan screen.
  const openPortal = async (which: "manage" | "change") => {
    setBusy(which);
    try {
      const url = await createPortal(window.location.href, which === "change" ? "update" : undefined);
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("plan.portalFailed"));
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("plan.title")}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {loading ? "…" : label}
            {comped && (
              <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary align-middle">
                {t("plan.compBadge")}
              </span>
            )}
          </p>
          {comped ? (
            <p className="text-[11px] text-primary">
              {renews ? t("plan.compUntil", { date: renews }) : t("plan.comp")}
            </p>
          ) : subscribed && renews && (
            <p className="text-[11px] text-muted-foreground">
              {cancelsAtPeriodEnd ? t("plan.cancels", { date: renews }) : t("plan.renews", { date: renews })}
            </p>
          )}
          {!comped && inGrace && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500">
              {trimDays && trimDays > 0
                ? t("plan.trimWarning", { count: trimDays, date: graceUntil })
                : t("plan.trimmed")}
            </p>
          )}
          {!subscribed && !inGrace && (
            <p className="text-[11px] text-muted-foreground">{t("plan.upgrade")}</p>
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
                {t("plan.changePlan")}
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
              {t("plan.manageSubscription")}
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
  const { t } = useTranslation("plugins");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("storage.title")}</p>
        <p className="text-[11px] text-muted-foreground">
          {local ? t("storage.onThisDevice") : t("storage.alwaysFree")}
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!usage && !error && <p className="text-xs text-muted-foreground">{t("storage.loadingUsage")}</p>}
      {usage && <StorageBar usage={usage} local={local} />}
    </div>
  );
}

// One pooled byte budget, drawn as a single stacked bar: logs + snapshots + garage
// data share the limit (like a phone's storage screen). Segments are coloured; the
// empty remainder is muted. Over the limit, segments fill the whole bar and the
// readout turns destructive. `local` measures this device against the browser quota.
function StorageBar({ usage, local }: { usage: StorageUsage; local: boolean }) {
  const { t } = useTranslation("plugins");
  const used = totalUsed(usage);
  const over = used > usage.totalLimit;
  const fractions = segmentFractions(usage);
  const pct = Math.round(usageFraction(used, usage.totalLimit) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{t("storage.percentUsed", { pct })}</span>
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
            <span className="text-foreground">{t(seg.labelKey)}</span>
            <span className="tabular-nums text-muted-foreground">{formatBytes(usage[seg.key])}</span>
          </div>
        ))}
      </div>

      {local ? (
        <p className="text-[11px] text-muted-foreground">
          {t("storage.localNote")}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {t("storage.cloudNote")}
        </p>
      )}

      {over && !local && (
        <p className="text-[11px] text-destructive">
          {t("storage.overLimit")}
        </p>
      )}
    </div>
  );
}
