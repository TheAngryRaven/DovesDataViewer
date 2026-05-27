import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useDocumentHead } from "@/hooks/useDocumentHead";

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';

const Privacy = () => {
  useDocumentHead({
    title: "Privacy Policy — HackTheTrack",
    description: "How HackTheTrack handles your data: local-first telemetry storage in your browser with optional cloud sync, no cookies, no analytics, no tracking.",
    canonical: "https://hackthetrack.net/privacy",
  });
  return (
  <div className="min-h-screen bg-background text-foreground p-6 md:p-12 max-w-3xl mx-auto">
    <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8">
      <ArrowLeft className="w-4 h-4" />
      <span className="text-sm">Back to app</span>
    </Link>

    <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>

    <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">Who Operates This Service</h2>
        <p>
          HackTheTrack is operated by <strong className="text-foreground">PerchWerks LLC</strong>,
          based in Windermere, Florida, United States. Where this policy refers to
          &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our,&rdquo; it means PerchWerks LLC.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">Local-First Data Storage</h2>
        <p>
          By default, all of your telemetry data, session files, lap notes, kart profiles, setup
          sheets, graph preferences, and video sync settings are stored entirely in your browser
          using IndexedDB and localStorage. <strong className="text-foreground">Unless you sign in
          and opt into cloud sync, nothing leaves your device.</strong>
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">Optional Accounts &amp; Cloud Sync</h2>
        <p>
          If you choose to create an account and enable cloud sync, the data you sync (such as
          session logs, your garage, setups, and notes) is stored on our cloud infrastructure so it
          is available across your devices. This is entirely optional — the core app works fully
          offline without an account. We use your email address for authentication and account-related
          communication only. Paid subscriptions are processed by our payment provider (Stripe); we do
          not store your full payment card details.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">AI-Powered Features</h2>
        <p>
          Some optional features may use AI processing. When you use such a feature, the relevant
          data (for example, telemetry from the session you are analyzing) may be sent to a
          third-party AI provider to generate the result. These features are opt-in and are not
          used unless you actively invoke them. The specific AI provider may change over time; this
          policy will be updated to reflect the provider in use.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">No Cookies or Tracking</h2>
        <p>
          This application does not use cookies, analytics scripts, or any third-party tracking.
          There are no advertising networks, no telemetry beacons, and no fingerprinting.
        </p>
      </section>

      {enableAdmin && (
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">Track &amp; Course Submissions</h2>
          <p>
            When you submit a track or course to the community database, your IP address is logged
            solely for the purpose of spam prevention and rate limiting. This information is not
            shared with any third party and is used only to enforce submission limits and block abuse.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">No Personal Information Required</h2>
        <p>
          No account, email address, or personal information is required to use any core feature
          of this application. It works fully offline once loaded. An account is only needed if you
          choose to use the optional cloud features described above.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">Clearing Your Data</h2>
        <p>
          Since all data is stored locally in your browser, you can remove it at any time by
          clearing your site data through your browser's settings (Settings → Privacy → Clear
          browsing data → Site data), or by using your browser's developer tools to delete
          the IndexedDB database and localStorage entries for this site.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">Governing Law</h2>
        <p>
          This Privacy Policy and any dispute arising from it are governed by the laws of the State
          of Florida, United States, without regard to its conflict-of-law provisions.
        </p>
      </section>
    </div>

    <p className="mt-10 text-xs text-muted-foreground/60">Last updated: May 2026</p>
  </div>
  );
};

export default Privacy;
