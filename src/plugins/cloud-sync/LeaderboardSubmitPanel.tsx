import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Check } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { formatLapTime } from "@/lib/lapCalculation";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import { listSnapshots } from "@/lib/lapSnapshotStorage";
import { onGarageChange } from "@/lib/garageEvents";
import { STORE_NAMES } from "@/lib/dbUtils";
import {
  contentHashForSnapshot, defaultListedWeight, isValidListedWeight,
} from "./leaderboardSubmission";
import { buildNewEntryRow, fetchMyEntries, insertEntries } from "./leaderboardClient";
import { getMyProfile } from "./profile";

/** Per-snapshot form state in the submit dialog. */
interface RowState {
  weight: string;
  unit: "lb" | "kg";
  shareSetup: boolean;
  shareEngine: boolean;
  busy: boolean;
}

// Profile-tab panel: submit your lap snapshots to the public leaderboards. Visible
// only when signed in (submission needs an account) and you have ≥1 snapshot.
export default function LeaderboardSubmitPanel(_props: PluginPanelProps) {
  const { t } = useTranslation("plugins");
  const { user, loading } = useAuth();
  const [snaps, setSnaps] = useState<LapSnapshot[]>([]);
  const [submittedHashes, setSubmittedHashes] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const local = await listSnapshots();
    setSnaps(local);
    if (user) {
      try {
        const mine = await fetchMyEntries(user.id);
        setSubmittedHashes(new Set(mine.map((e) => e.contentHash)));
      } catch (e) {
        // Leave the known set as-is; the DB unique constraint is the backstop.
        console.warn("[leaderboard] couldn't load existing entries:", e);
      }
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    return onGarageChange((c) => {
      if (c.store === STORE_NAMES.LAP_SNAPSHOTS) void refresh();
    });
  }, [refresh]);

  // Seed per-row form defaults whenever the snapshot list changes.
  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const s of snaps) {
        const d = defaultListedWeight(s);
        next[s.id] = prev[s.id] ?? {
          weight: d.weight !== null ? String(d.weight) : "",
          unit: d.unit,
          shareSetup: false,
          shareEngine: false,
          busy: false,
        };
      }
      return next;
    });
  }, [snaps]);

  const hashes = useMemo(() => new Map(snaps.map((s) => [s.id, contentHashForSnapshot(s)])), [snaps]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (!user) return <p className="text-xs text-muted-foreground">{t("leaderboard.signInHint")}</p>;
  if (snaps.length === 0) return <p className="text-xs text-muted-foreground">{t("leaderboard.noSnapshots")}</p>;

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const submit = async (snap: LapSnapshot) => {
    const row = rows[snap.id];
    const weight = Number(row.weight);
    if (!isValidListedWeight(weight)) {
      toast.error(t("leaderboard.weightRequired"));
      return;
    }
    setRow(snap.id, { busy: true });
    try {
      const profile = await getMyProfile(user.id);
      const displayName = profile?.display_name ?? user.email ?? "Anonymous";
      const newRow = buildNewEntryRow(snap, {
        userId: user.id,
        displayName,
        setupPublic: row.shareSetup,
        engineTelemetryPublic: row.shareEngine,
        listedWeight: weight,
        listedWeightUnit: row.unit,
      });
      await insertEntries([newRow]);
      setSubmittedHashes((s) => new Set(s).add(newRow.content_hash));
      toast.success(t("leaderboard.submitSuccess"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[leaderboard] submit failed:", e);
      toast.error(/duplicate key|unique/i.test(msg) ? t("leaderboard.alreadySubmitted") : t("leaderboard.submitFailed"));
    } finally {
      setRow(snap.id, { busy: false });
    }
  };

  const submittableCount = snaps.filter((s) => !submittedHashes.has(hashes.get(s.id) ?? "")).length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t("leaderboard.intro", { count: snaps.length })}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" className="h-8 gap-1.5" disabled={submittableCount === 0}>
            <Trophy className="h-4 w-4" />
            {t("leaderboard.submitButton")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("leaderboard.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("leaderboard.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {snaps.map((snap) => {
              const row = rows[snap.id];
              if (!row) return null;
              const done = submittedHashes.has(hashes.get(snap.id) ?? "");
              return (
                <div key={snap.id} className="rounded-md border border-border p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {snap.engine}
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                          {formatLapTime(snap.lapTimeMs)}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {snap.trackName} — {snap.courseName}
                      </p>
                    </div>
                    {done ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5 text-green-500" />
                        {t("leaderboard.submitted")}
                      </span>
                    ) : (
                      <Button size="sm" className="h-7 text-xs" disabled={row.busy} onClick={() => void submit(snap)}>
                        {row.busy ? t("leaderboard.submitting") : t("leaderboard.submitOne")}
                      </Button>
                    )}
                  </div>

                  {!done && (
                    <>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Label htmlFor={`w-${snap.id}`} className="text-xs text-muted-foreground">
                            {t("leaderboard.listedWeight")}
                          </Label>
                          <Input
                            id={`w-${snap.id}`}
                            type="number"
                            inputMode="decimal"
                            className="h-8"
                            value={row.weight}
                            onChange={(e) => setRow(snap.id, { weight: e.target.value })}
                          />
                        </div>
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={row.unit}
                          onChange={(e) => setRow(snap.id, { unit: e.target.value as "lb" | "kg" })}
                          aria-label={t("leaderboard.listedWeight")}
                        >
                          <option value="lb">lb</option>
                          <option value="kg">kg</option>
                        </select>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t("leaderboard.listedWeightHint")}</p>

                      <div className="flex items-center gap-2">
                        <Switch id={`setup-${snap.id}`} checked={row.shareSetup} onCheckedChange={(v) => setRow(snap.id, { shareSetup: v })} />
                        <Label htmlFor={`setup-${snap.id}`} className="text-xs text-muted-foreground">{t("leaderboard.shareSetup")}</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch id={`eng-${snap.id}`} checked={row.shareEngine} onCheckedChange={(v) => setRow(snap.id, { shareEngine: v })} />
                        <Label htmlFor={`eng-${snap.id}`} className="text-xs text-muted-foreground">{t("leaderboard.shareEngineData")}</Label>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t("leaderboard.publicNotice")}</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
