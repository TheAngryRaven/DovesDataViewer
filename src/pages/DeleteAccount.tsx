import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Loader2, ShieldX, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useDocumentHead } from "@/hooks/useDocumentHead";
import {
  cancelAccountDeletion,
  getPendingDeletion,
  scheduleAccountDeletion,
  sendDeletionCode,
  type PendingDeletion,
} from "@/plugins/cloud-sync/accountDeletion";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

// Public, no-app-shell page that lets someone request deletion of their cloud
// account — the web URL Google Play requires alongside the in-app flow. It signs
// the user in first (the deletion edge function derives the account from the
// session), then reuses the same emailed-code flow as the in-app panel. The page
// is English-only by design, like the Privacy and Terms pages it sits beside.
//
// The page is mounted un-gated in App.tsx so the published URL always resolves;
// when the build has no cloud accounts it shows an explanatory note instead.
export default function DeleteAccount() {
  useDocumentHead({
    title: "Delete your account — LapWing",
    description: "Request permanent deletion of your LapWing cloud account and all associated data.",
    canonical: "https://lapwingdata.com/delete-account",
  });

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-12 max-w-2xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back to app</span>
      </Link>

      <h1 className="text-2xl font-bold mb-6">Delete your account</h1>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <p>
          Deleting your account permanently removes your cloud data — synced
          session logs, garage data (vehicles, setups, notes), lap snapshots, your
          profile, and any subscription record. Data stored only on your device is
          not affected and can be cleared separately from your browser.
        </p>
        <p>
          To protect you against someone else using a stolen session, deletion is
          confirmed with a one-time code emailed to your account address, then
          scheduled <strong className="text-foreground">7 days</strong> out. You
          can cancel any time before then; after that, the data is permanently
          erased.
        </p>
        <p>
          If you are signed in on a device, you can also do this from{" "}
          <strong className="text-foreground">Profile → Data &amp; privacy</strong>{" "}
          inside the app.
        </p>

        {enableCloud ? <DeletionFlow /> : <CloudDisabledNote />}
      </div>
    </div>
  );
}

function CloudDisabledNote() {
  return (
    <div className="rounded-md border border-border bg-card p-4 text-sm">
      <p>
        This build of the app doesn’t include cloud accounts, so there is nothing
        to delete here. Account deletion applies to the hosted service at{" "}
        <strong className="text-foreground">lapwingdata.com</strong>. Data created
        in this app lives only in your browser and can be removed by clearing this
        site’s data.
      </p>
    </div>
  );
}

// Signs the visitor in (required by the deletion edge function), then runs the
// emailed-code deletion flow.
function DeletionFlow() {
  const { user, login, logout } = useAuth();
  const online = useOnlineStatus();
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

  if (!user) return <SignIn login={login} online={online} />;

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <p className="text-xs">
        Signed in as <strong className="text-foreground">{user.email}</strong>.{" "}
        <button onClick={() => void logout()} className="underline hover:no-underline">
          Sign out
        </button>
      </p>
      {pending ? (
        <PendingNotice pending={pending} userId={user.id} online={online} onChange={refreshPending} />
      ) : (
        <DeleteSteps email={user.email ?? ""} online={online} onScheduled={refreshPending} />
      )}
    </div>
  );
}

function SignIn({
  login,
  online,
}: {
  login: (email: string, password: string) => Promise<{ error: Error | null }>;
  online: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await login(email, password);
    setBusy(false);
    if (error) toast.error(error.message || "Sign-in failed.");
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">Sign in to confirm it’s your account.</p>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" disabled={busy || !online}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Sign in
      </Button>
      {!online && <p className="text-xs text-muted-foreground">You’re offline — reconnect to continue.</p>}
    </form>
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
      toast.success("Deletion cancelled.");
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t cancel deletion.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
      <div className="flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Your account is scheduled for deletion on <strong>{when}</strong>. Cancel
          before then to keep it.
        </span>
      </div>
      <Button variant="outline" size="sm" disabled={busy || !online} onClick={() => void cancel()}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Cancel deletion
      </Button>
    </div>
  );
}

type Step = "idle" | "code" | "working";

function DeleteSteps({
  email,
  online,
  onScheduled,
}: {
  email: string;
  online: boolean;
  onScheduled: () => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [code, setCode] = useState("");

  const startCode = async () => {
    setStep("working");
    try {
      await sendDeletionCode(email);
      toast.success(`We emailed a code to ${email}.`);
      setStep("code");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t send the code.");
      setStep("idle");
    }
  };

  const confirm = async () => {
    setStep("working");
    try {
      // The edge function verifies the code server-side, so pass it straight
      // through rather than consuming it with a client-side verify first.
      const result = await scheduleAccountDeletion(code);
      toast.success(`Deletion scheduled for ${new Date(result.scheduled_for).toLocaleDateString()}.`);
      setCode("");
      setStep("idle");
      await onScheduled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That code didn’t work.");
      setStep("code");
    }
  };

  return (
    <div className="space-y-3">
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
            placeholder="Emailed code"
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

      {!online && <p className="text-xs text-muted-foreground">You’re offline — reconnect to continue.</p>}
    </div>
  );
}
