import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';

const Privacy = () => (
  <div className="min-h-screen bg-background text-foreground p-6 md:p-12 max-w-3xl mx-auto">
    <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8">
      <ArrowLeft className="w-4 h-4" />
      <span className="text-sm">Back to app</span>
    </Link>

    <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>

    <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
      <section>
        <h2 className="text-base font-semibold text-foreground mb-2">Local-First Data Storage</h2>
        <p>
          All of your telemetry data, session files, lap notes, kart profiles, setup sheets,
          graph preferences, and video sync settings are stored entirely in your browser using
          IndexedDB and localStorage. <strong className="text-foreground">Nothing leaves your device.</strong>
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
          of this application. It works fully offline once loaded.
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
    </div>

    <p className="mt-10 text-xs text-muted-foreground/60">Last updated: February 2026</p>
  </div>
);

export default Privacy;
