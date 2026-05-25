import { useCallback, useEffect, useState } from "react";
import { User as UserIcon } from "lucide-react";
import type { PluginPanelProps } from "@/plugins/panels";
import { useAuth } from "@/contexts/AuthContext";
import { getStorageUsage } from "./syncEngine";
import { formatBytes, usageFraction, type TierUsage } from "./tiers";

const TIER_LABEL: Record<string, string> = { documents: "Documents", logs: "Logs" };
const TIER_HINT: Record<string, string> = {
  documents: "Vehicles, setups, templates & notes — free, auto-synced.",
  logs: "Session log files you've chosen to sync.",
};

// Scratch-pad profile panel: who you're signed in as + your cloud storage usage
// against the document/log tier limits. (Display name / avatar are placeholders
// until profiles land.)
export default function StoragePanel(_props: PluginPanelProps) {
  const { user, loading } = useAuth();
  const [usage, setUsage] = useState<TierUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      setUsage(await getStorageUsage());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load storage usage");
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!user) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Not signed in</p>
        <p className="text-xs text-muted-foreground">
          Sign in under Labs → Cloud Sync to back up your garage and see your storage usage.
        </p>
      </div>
    );
  }

  const displayName =
    (user.user_metadata?.display_name as string | undefined) || user.email || "Driver";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Storage</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!usage && !error && <p className="text-xs text-muted-foreground">Loading usage…</p>}
        {usage?.map((u) => (
          <Meter key={u.tier} usage={u} />
        ))}
      </div>
    </div>
  );
}

function Meter({ usage }: { usage: TierUsage }) {
  const pct = Math.round(usageFraction(usage) * 100);
  const over = usage.usedBytes > usage.limitBytes;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{TIER_LABEL[usage.tier] ?? usage.tier}</span>
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
      <p className="text-[11px] text-muted-foreground">{TIER_HINT[usage.tier]}</p>
    </div>
  );
}
