import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { AlertTriangle, Download, Loader2, ShieldX, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { downloadAccountExport } from "./accountExport";
import { importAccountArchive, type ImportSummary } from "./accountImport";
import {
  cancelAccountDeletion,
  getPendingDeletion,
  scheduleAccountDeletion,
  sendDeletionCode,
  type PendingDeletion,
} from "./accountDeletion";

type DeleteStep = "idle" | "code" | "working";

// Profile-tab panel for GDPR self-service: export everything as a ZIP, and a
// scheduled (7-day, reversible) account deletion gated by an emailed code.
export default function DataPrivacyPanel(_props: PluginPanelProps) {
  const { t } = useTranslation("plugins");
  const { user } = useAuth();
  const online = useOnlineStatus();
  const email = user?.email ?? "";

  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState("");
  const [pending, setPending] = useState<PendingDeletion | null>(null);

  const refreshPending = useCallback(async () => {
    if (!user) return setPending(null);
    try {
      setPending(await getPendingDeletion(user.id));
    } catch {
      /* non-fatal: leave as-is */
    }
  }, [user]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const runExport = async () => {
    setExporting(true);
    try {
      await downloadAccountExport((p) => setExportPhase(p.phase));
      toast.success(t("dataPrivacy.exportDownloaded"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("dataPrivacy.exportFailed"));
    } finally {
      setExporting(false);
      setExportPhase("");
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dataPrivacy.yourData")}</p>
        <p className="text-xs text-muted-foreground">
          {user ? t("dataPrivacy.exportBlurbSignedIn") : t("dataPrivacy.exportBlurbSignedOut")}
        </p>
        <Button onClick={() => void runExport()} disabled={exporting} variant="outline">
          {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
          {exporting ? (exportPhase || t("dataPrivacy.preparing")) : t("dataPrivacy.downloadMyData")}
        </Button>
      </section>

      <ImportData />


      {user && (
        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dataPrivacy.deleteAccount")}</p>
          {pending ? (
            <PendingNotice pending={pending} userId={user.id} online={online} onChange={refreshPending} />
          ) : (
            <DeleteFlow email={email} online={online} onScheduled={refreshPending} />
          )}
        </section>
      )}
    </div>
  );
}

// Restore a previously exported ZIP into this browser — the migration path for
// users moving between origins (per-origin local storage doesn't carry over).
// Works signed in or out (it's a local restore); existing files are never
// clobbered. A reload surfaces the restored files/garage (read on mount).
function ImportData() {
  const { t } = useTranslation("plugins");
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      setResult(await importAccountArchive(file));
    } catch {
      toast.error(t("dataPrivacy.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dataPrivacy.importTitle")}</p>
      <p className="text-xs text-muted-foreground">{t("dataPrivacy.importBlurb")}</p>
      <input ref={inputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void onFile(e)} />
      <Button variant="outline" disabled={importing} onClick={() => inputRef.current?.click()}>
        {importing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
        {importing ? t("dataPrivacy.importing") : t("dataPrivacy.importButton")}
      </Button>
      {result && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("dataPrivacy.importDone", { files: result.files, records: result.records })}</span>
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            {t("dataPrivacy.importReload")}
          </Button>
        </div>
      )}
    </section>
  );
}

function PendingNotice({
  pending,
  userId,
  online,
  onChange,
}: {
  pending: PendingDeletion;
  userId: string;
  online: boolean;
  onChange: () => Promise<void>;
}) {
  const { t } = useTranslation("plugins");
  const [busy, setBusy] = useState(false);
  const when = new Date(pending.scheduled_for).toLocaleString();

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelAccountDeletion(userId);
      toast.success(t("dataPrivacy.cancelled"));
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("dataPrivacy.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
      <div className="flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <Trans ns="plugins" i18nKey="dataPrivacy.scheduledNotice" values={{ when }} components={{ b: <strong /> }} />
        </span>
      </div>
      <Button variant="outline" size="sm" disabled={busy || !online} onClick={() => void cancel()}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {t("dataPrivacy.cancelDeletion")}
      </Button>
    </div>
  );
}

function DeleteFlow({
  email,
  online,
  onScheduled,
}: {
  email: string;
  online: boolean;
  onScheduled: () => Promise<void>;
}) {
  const { t } = useTranslation("plugins");
  const [step, setStep] = useState<DeleteStep>("idle");
  const [code, setCode] = useState("");

  const startCode = async () => {
    setStep("working");
    try {
      await sendDeletionCode(email);
      toast.success(t("dataPrivacy.emailedCode", { email }));
      setStep("code");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("dataPrivacy.sendCodeFailed"));
      setStep("idle");
    }
  };

  const confirm = async () => {
    setStep("working");
    try {
      // The edge function verifies the code server-side, so we pass it straight
      // through rather than consuming it with a client-side verify first.
      const result = await scheduleAccountDeletion(code);
      toast.success(t("dataPrivacy.scheduledFor", { date: new Date(result.scheduled_for).toLocaleDateString() }));
      setCode("");
      setStep("idle");
      await onScheduled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("dataPrivacy.codeFailed"));
      setStep("code");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <Trans ns="plugins" i18nKey="dataPrivacy.deleteBlurb" components={{ b: <strong /> }} />
      </p>

      {step === "idle" && (
        <Button variant="destructive" size="sm" disabled={!online} onClick={() => void startCode()}>
          <Trash2 className="mr-1.5 h-4 w-4" /> {t("dataPrivacy.deleteMyAccount")}
        </Button>
      )}

      {step === "working" && (
        <Button variant="destructive" size="sm" disabled>
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t("dataPrivacy.working")}
        </Button>
      )}

      {step === "code" && (
        <div className="space-y-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("dataPrivacy.codePlaceholder")}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            className="h-9 w-40"
          />
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={!code.trim() || !online} onClick={() => void confirm()}>
              <ShieldX className="mr-1.5 h-4 w-4" /> {t("dataPrivacy.confirmDeletion")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCode(""); setStep("idle"); }}>
              {t("dataPrivacy.cancel")}
            </Button>
          </div>
        </div>
      )}

      {!online && (
        <p className="text-xs text-muted-foreground">{t("dataPrivacy.offlineDelete")}</p>
      )}
    </div>
  );
}
