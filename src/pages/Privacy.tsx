import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useDocumentHead } from "@/hooks/useDocumentHead";

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === "true";
const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

// NOTE FOR THE OPERATOR: this policy adapts to the build flags. With cloud
// features off it describes the offline-only app; with VITE_ENABLE_CLOUD on it
// also covers accounts, payments and AI. Placeholders to confirm before relying
// on this for the hosted service: the operating entity's legal name, a contact
// email, and the specific AI provider used by the coaching plugin. This is a
// drafted policy, not legal advice — have it reviewed for your jurisdiction.

const Privacy = () => {
  useDocumentHead({
    title: "Privacy Policy — HackTheTrack",
    description:
      "How HackTheTrack handles your data: offline-first telemetry stored in your browser, with optional cloud sync and AI features when you create an account.",
    canonical: "https://hackthetrack.net/privacy",
  });
  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-12 max-w-3xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back to app</span>
      </Link>

      <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            The short version
          </h2>
          <p>
            HackTheTrack is offline-first. By default, everything you do —
            importing telemetry, taking notes, building kart profiles and setup
            sheets — stays in your browser and{" "}
            <strong className="text-foreground">never leaves your device</strong>.
            {enableCloud
              ? " Some features are optional and online: creating an account to back up and sync your data, paid storage plans, and AI coaching. Those features only send data off your device after you choose to use them, and this policy explains exactly what each one collects."
              : " This build has no accounts, no cloud sync and no analytics."}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            Local-First Data Storage
          </h2>
          <p>
            Your telemetry data, session files, lap notes, kart profiles, setup
            sheets, graph preferences, and video sync settings are stored in your
            browser using IndexedDB and localStorage. Using the core app requires{" "}
            <strong className="text-foreground">
              no account and no personal information
            </strong>
            , and works fully offline once loaded.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            No Tracking or Advertising
          </h2>
          <p>
            We do not use analytics scripts, advertising networks, telemetry
            beacons, or fingerprinting, and we do not sell or rent your data to
            anyone. We use only the storage strictly necessary to run the app
            (see “Cookies &amp; Local Storage” below).
          </p>
        </section>

        {enableCloud && (
          <>
            <section>
              <h2 className="text-base font-semibold text-foreground mb-2">
                Optional Accounts &amp; Cloud Sync
              </h2>
              <p className="mb-2">
                If you create an account, you can back up and sync your data
                across devices. This is entirely optional and opt-in. When you
                use it, the following is stored on our backend (Supabase) under
                your account and protected so that only you can access it:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong className="text-foreground">Account details:</strong>{" "}
                  your email address, an encrypted password (or a Google sign-in
                  identifier if you use Google), and a display name (which you
                  choose, or which is randomly generated).
                </li>
                <li>
                  <strong className="text-foreground">Garage data:</strong>{" "}
                  vehicles, setup sheets, setup templates, notes, graph
                  preferences and your custom tracks/courses. Notes and names are
                  free text — anything you type there is stored as written.
                </li>
                <li>
                  <strong className="text-foreground">Session logs:</strong>{" "}
                  only the telemetry files you explicitly choose to sync. These
                  contain{" "}
                  <strong className="text-foreground">
                    precise GPS location traces
                  </strong>{" "}
                  of where and when you drove.
                </li>
              </ul>
              <p className="mt-2">
                Our legal basis for this processing is performance of our
                agreement with you — we cannot provide sync without storing your
                data. You can delete cloud copies at any time (see “Your Rights”).
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-2">
                Payments &amp; Subscriptions
              </h2>
              <p>
                Paid storage plans are processed by{" "}
                <strong className="text-foreground">Stripe</strong>. We do not
                receive or store your full card number — Stripe handles card data
                directly. We receive only what we need to manage your
                subscription (e.g. plan, status, and a Stripe customer/
                subscription identifier). Stripe’s handling of your payment data
                is governed by{" "}
                <a
                  href="https://stripe.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline hover:no-underline"
                >
                  Stripe’s Privacy Policy
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-2">
                AI Coaching
              </h2>
              <p>
                If you use the optional AI coaching feature, the telemetry needed
                to generate feedback (such as GPS traces and lap data, and any
                driver name attached to the session) is sent to a{" "}
                <strong className="text-foreground">
                  third-party AI provider
                </strong>{" "}
                to be processed. We send this only when you choose to run the
                coach. AI output is generated automatically and may be inaccurate
                — it is informational only and must not be relied on for safety
                decisions (see our{" "}
                <Link to="/terms" className="text-foreground underline hover:no-underline">
                  Terms of Service
                </Link>
                ).
              </p>
            </section>
          </>
        )}

        {(enableCloud || enableAdmin) && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Security &amp; Abuse Prevention (IP logging)
            </h2>
            <p>
              To prevent spam and abuse, we briefly log the{" "}
              <strong className="text-foreground">IP address</strong> associated
              with certain actions — {enableCloud ? "sign-in attempts, " : ""}
              contact-form messages
              {enableAdmin ? ", and community track/course submissions" : ""}.
              This is used solely for rate-limiting and blocking abuse (our
              legitimate interest in keeping the service available) and is not
              used to track you or shared with advertisers.
            </p>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            Contact Form
          </h2>
          <p>
            If you send us a message through the in-app contact form, we receive
            your message, the category you select, and — only if you provide it —
            your email address so we can reply. Providing an email is optional.
          </p>
        </section>

        {enableCloud && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Third-Party Services (Sub-processors)
            </h2>
            <p className="mb-2">
              When you use the optional online features, the following providers
              process data on our behalf:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong className="text-foreground">Supabase</strong> — account,
                database and file storage for cloud sync.
              </li>
              <li>
                <strong className="text-foreground">Stripe</strong> — subscription
                payments.
              </li>
              <li>
                <strong className="text-foreground">Google</strong> — only if you
                choose “Sign in with Google”.
              </li>
              <li>
                <strong className="text-foreground">Cloudflare Turnstile</strong>{" "}
                — bot/abuse protection on sign-up.
              </li>
              <li>
                <strong className="text-foreground">
                  The AI coaching provider
                </strong>{" "}
                — only if you use AI coaching.
              </li>
            </ul>
            <p className="mt-2">
              Map tiles (CartoDB, Esri) and weather (OpenWeatherMap) are loaded
              from third parties when you view a map or fetch weather; like any
              web request, these receive your IP address and the data needed to
              serve the request.
            </p>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            Cookies &amp; Local Storage
          </h2>
          <p>
            We do not use advertising or tracking cookies.
            {enableCloud
              ? " If you sign in, we store a session/authentication token in your browser so you stay logged in — this is strictly necessary for the account feature to work."
              : ""}{" "}
            All other storage (IndexedDB and localStorage) holds your own app data
            on your device.
          </p>
        </section>

        {enableCloud && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Your Rights
            </h2>
            <p className="mb-2">
              If you have an account, you have rights over your data, including
              under the EU/UK GDPR and similar laws (e.g. California’s CCPA/CPRA):
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong className="text-foreground">Access &amp; portability:</strong>{" "}
                download a complete copy of everything we hold — your account data
                plus the data stored in this browser — as a ZIP from{" "}
                <strong className="text-foreground">Profile → Data &amp; privacy</strong>
                . Synced files can also be pulled back to any device at any time.
              </li>
              <li>
                <strong className="text-foreground">Rectification:</strong> edit
                your display name, notes and other data directly in the app.
              </li>
              <li>
                <strong className="text-foreground">Erasure:</strong> delete cloud
                copies of individual files and garage data from within the app, or
                delete your <strong className="text-foreground">entire account</strong>{" "}
                and all associated data yourself from{" "}
                <strong className="text-foreground">Profile → Data &amp; privacy</strong>
                . For your protection (e.g. against a hijacked session), account
                deletion is confirmed by an emailed code and then scheduled{" "}
                <strong className="text-foreground">7 days</strong> out — you can
                cancel any time before then, after which all your data is
                permanently erased.
              </li>
              <li>
                <strong className="text-foreground">Objection / restriction:</strong>{" "}
                you can stop using online features at any time and continue using
                the app fully offline.
              </li>
            </ul>
            <p className="mt-2">
              To exercise any right we can’t fully self-serve in the app, contact
              us through the in-app contact form. You also have the right to
              complain to your local data-protection authority.
            </p>
          </section>
        )}

        {enableCloud && (
          <>
            <section>
              <h2 className="text-base font-semibold text-foreground mb-2">
                Data Retention
              </h2>
              <p>
                We keep your account and synced data for as long as your account
                exists. When you delete data or your account, we remove it from
                active storage; a deleted account and all its data are permanently
                erased 7 days after you request deletion (the cancellable grace
                window described under “Your Rights”). Abuse-prevention IP
                addresses are minimised automatically: the IP attached to a
                contact-form message or community submission is erased{" "}
                <strong className="text-foreground">90 days</strong> after it was
                received, and expired IP bans and sign-in rate-limit records are
                cleared daily.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-foreground mb-2">
                International Transfers
              </h2>
              <p>
                Our providers may process data in countries outside your own,
                including the United States. Where required, transfers are covered
                by appropriate safeguards (such as the providers’ Standard
                Contractual Clauses).
              </p>
            </section>
          </>
        )}

        {enableCloud && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Children
            </h2>
            <p>
              Online accounts are intended for users{" "}
              <strong className="text-foreground">16 or older</strong>. If you are
              under 16, please use the app in its offline mode only and do not
              create an account. If you believe a child under 16 has created an
              account, contact us and we will remove it.
            </p>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            Self-Hosting
          </h2>
          <p>
            HackTheTrack is open source. If someone else runs their own instance,
            they — not us — control any data collected by that instance, and this
            policy describes only the official hosted service.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            Clearing Your Data
          </h2>
          <p>
            Because local data lives in your browser, you can remove it any time
            by clearing this site’s data (Settings → Privacy → Clear browsing data
            → Site data) or by deleting the IndexedDB database and localStorage
            entries via your browser’s developer tools.
            {enableCloud
              ? " Cloud data is removed separately using the in-app delete controls, or all at once by deleting your account from Profile → Data & privacy."
              : ""}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            Changes &amp; Contact
          </h2>
          <p>
            We may update this policy as the app evolves; material changes will be
            reflected by the “Last updated” date below. Questions or requests can
            be sent through the in-app contact form.
          </p>
        </section>
      </div>

      <p className="mt-10 text-xs text-muted-foreground/60">
        Last updated: May 2026
      </p>
    </div>
  );
};

export default Privacy;
