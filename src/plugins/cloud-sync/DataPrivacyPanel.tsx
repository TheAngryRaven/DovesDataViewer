import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, ShieldX, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PluginPanelProps } from "@/plugins/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { downloadAccountExport } from "./accountExport";
import {
  cancelAccountDeletion,
  getPendingDeletion,
  scheduleAccountDeletion,
  sendDeletionCode,
  verifyDeletionCode,
  type PendingDeletion,
} from "./accountDeletion";

type DeleteStep = "idle" | "code" | "working";

// Profile-tab panel for GDPR self-service: export everything as a ZIP, and a
// scheduled (7-day, reversible) account deletion gated by an emailed code.
export default function DataPrivacyPanel(_props: PluginPanelProps) {
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
      toast.success("Your data export has been downloaded.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
      setExportPhase("");
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your data</p>
        <p className="text-xs text-muted-foreground">
          Download a copy of everything we hold about you — {user ? "your account data plus " : ""}
          the data stored in this browser — as a ZIP. This is your right to access and portability.
        </p>
        <Button onClick={() => void runExport()} disabled={exporting} variant="outline">
          {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
          {exporting ? (exportPhase || "Preparing…") : "Download my data"}
        </Button>
      </section>

      {user && (
        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Delete account</p>
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
  const [busy, setBusy] = useState(false);
  const when = new Date(pending.scheduled_for).toLocaleString();

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelAccountDeletion(userId);
      toast.success("Account deletion cancelled.");
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel deletion.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
      <div className="flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Your account and all its data are scheduled for permanent deletion on{" "}
          <strong>{when}</strong>. You can cancel any time before then.
        </span>
      </div>
      <Button variant="outline" size="sm" disabled={busy || !online} onClick={() => void cancel()}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Cancel deletion
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
  const [step, setStep] = useState<DeleteStep>("idle");
  const [code, setCode] = useState("");

  const startCode = async () => {
    setStep("working");
    try {
      await sendDeletionCode(email);
      toast.success(`We emailed a confirmation code to ${email}.`);
      setStep("code");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the code.");
      setStep("idle");
    }
  };

  const confirm = async () => {
    setStep("working");
    try {
      await verifyDeletionCode(email, code);
      const result = await scheduleAccountDeletion();
      toast.success(`Deletion scheduled for ${new Date(result.scheduled_for).toLocaleDateString()}.`);
      setCode("");
      setStep("idle");
      await onScheduled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That code didn't work — try again.");
      setStep("code");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Deletes your account and everything stored under it (profile, synced files, garage data,
        subscription record). To protect against a hijacked session, we email you a code first and
        then wait <strong>7 days</strong> before erasing anything — you can cancel during that time.
        Data stored only in this browser is not removed by this; clear it from your browser settings.
      </p>

      {step === "idle" && (
        <Button variant="destructive" size="sm" disabled={!online} onClick={() => void startCode()}>
          <Trash2 className="mr-1.5 h-4 w-4" /> Delete my account
        </Button>
      )}

      {step === "working" && (
        <Button variant="destructive" size="sm" disabled>
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Working…
        </Button>
      )}

      {step === "code" && (
        <div className="space-y-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            className="h-9 w-40"
          />
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={!code.trim() || !online} onClick={() => void confirm()}>
              <ShieldX className="mr-1.5 h-4 w-4" /> Confirm deletion
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCode(""); setStep("idle"); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!online && (
        <p className="text-xs text-muted-foreground">You're offline — account deletion needs a connection.</p>
      )}
    </div>
  );
}
