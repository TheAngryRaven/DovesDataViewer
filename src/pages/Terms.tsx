import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useDocumentHead } from "@/hooks/useDocumentHead";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

// NOTE FOR THE OPERATOR: drafted Terms, not legal advice — have them reviewed by
// a lawyer for your jurisdiction. The official hosted service is operated by
// PERCHWERKS LLC, based in Windermere, Florida, USA; contact
// champagne@perchwerks.com (interim) until dedicated support addresses exist.

const Terms = () => {
  useDocumentHead({
    title: "Terms of Service — LapWing",
    description:
      "The terms for using LapWing: offline-first telemetry app with optional cloud sync, paid storage plans, and AI coaching.",
    canonical: "https://lapwingdata.com/terms",
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

      <h1 className="text-2xl font-bold mb-6">Terms of Service</h1>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            1. Acceptance
          </h2>
          <p>
            By using LapWing (“the Service”), you agree to these Terms and to
            our{" "}
            <Link to="/privacy" className="text-foreground underline hover:no-underline">
              Privacy Policy
            </Link>
            . If you do not agree, please do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            2. The Service
          </h2>
          <p>
            LapWing is an offline-first motorsport telemetry viewer. The core
            app runs entirely in your browser and stores your data on your device.
            {enableCloud
              ? " Optional online features — creating an account, cloud sync, paid storage plans, and AI coaching — are available but are not required to use the core app."
              : ""}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            3. Eligibility
          </h2>
          <p>
            The offline app is available to anyone.{" "}
            {enableCloud
              ? "You must be at least 16 years old to create an account or use any online feature. If you are under 16, you may use the app in offline mode only and must not create an account."
              : "There is no account in this build."}
          </p>
        </section>

        {enableCloud && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              4. Accounts &amp; Security
            </h2>
            <p>
              You are responsible for keeping your account credentials secure and
              for activity under your account. Provide accurate information when
              registering, and let us know if you suspect unauthorized access.
            </p>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            5. Acceptable Use
          </h2>
          <p>
            Don’t misuse the Service: no unlawful activity, no attempts to break,
            overload, or gain unauthorized access to the Service or other users’
            data, no uploading of content you don’t have the right to use, and no
            using the Service to store or transmit malicious or infringing
            material.
          </p>
        </section>

        {enableCloud && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              6. Subscriptions &amp; Billing
            </h2>
            <p className="mb-2">
              Paid storage plans are billed through Stripe on a recurring basis
              (e.g. monthly) until cancelled. By subscribing, you authorize the
              recurring charge for your chosen plan.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                You can cancel at any time from the billing portal; cancellation
                stops future renewals and your plan remains active until the end
                of the current paid period.
              </li>
              <li>
                Prices and plan limits are shown in-app and may change with notice;
                changes apply from your next billing period.
              </li>
              <li>
                Where required by law (for example, EU/UK consumer withdrawal
                rights), you may be entitled to a refund — contact us and we’ll
                honor your statutory rights.
              </li>
              <li>
                If a payment fails or a subscription lapses, online storage limits
                revert to the free tier; your data on your device is unaffected.
              </li>
              <li>
                The Android app does not sell or manage subscriptions in-app: paid
                plans are purchased and managed on the web at lapwingdata.com. The
                app uses cloud sync on whatever plan your account already has.
              </li>
            </ul>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            7. Your Content &amp; Data
          </h2>
          <p>
            Your telemetry, notes, and other content remain yours. We don’t claim
            ownership of it.
            {enableCloud
              ? " If you use cloud sync, you grant us the limited permission needed to store, transmit, and process your content solely to provide the Service to you (for example, to sync it across your devices or generate AI coaching when you request it)."
              : ""}
          </p>
        </section>

        {enableCloud && (
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              8. AI Features — No Professional or Safety Advice
            </h2>
            <p>
              AI coaching is generated automatically and may be incomplete or
              wrong. It is provided for informational and entertainment purposes
              only. It is{" "}
              <strong className="text-foreground">not</strong> professional
              coaching, engineering, or safety advice, and you must not rely on it
              for decisions affecting safety on or off the track. You are solely
              responsible for how you drive. Using the AI feature sends the
              necessary session data to a third-party AI provider for processing
              (see the{" "}
              <Link to="/privacy" className="text-foreground underline hover:no-underline">
                Privacy Policy
              </Link>
              ).
            </p>
          </section>
        )}

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            9. Open Source &amp; Self-Hosting
          </h2>
          <p>
            LapWing’s source code is open source and licensed separately
            under its repository license; these Terms govern your use of the{" "}
            <em>official hosted Service</em>, not the code itself. If you run your
            own instance, you are responsible for it and for any data your
            instance collects, and you must provide your own terms and privacy
            notice to your users.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            10. Disclaimer of Warranties
          </h2>
          <p>
            The Service is provided{" "}
            <strong className="text-foreground">“as is” and “as available,”</strong>{" "}
            without warranties of any kind, whether express or implied, including
            fitness for a particular purpose, accuracy of telemetry or timing, and
            uninterrupted availability. Telemetry, lap times, and derived data may
            contain errors; do not rely on them for competition scoring or safety.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            11. Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by law, LapWing and its operators
            are not liable for any indirect, incidental, or consequential damages,
            or for loss of data, arising from your use of the Service. Nothing in
            these Terms limits liability that cannot be limited by law. Keep your
            own backups of important data.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            12. Termination
          </h2>
          <p>
            You may stop using the Service at any time
            {enableCloud ? " and delete your account" : ""}. We may suspend or
            terminate access that violates these Terms or harms the Service or its
            users.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            13. Changes to These Terms
          </h2>
          <p>
            We may update these Terms as the Service evolves. Material changes will
            be reflected by the “Last updated” date below; continuing to use the
            Service after changes means you accept them.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-2">
            14. Governing Law &amp; Contact
          </h2>
          <p>
            The official hosted Service is operated by{" "}
            <strong className="text-foreground">PERCHWERKS LLC</strong>, based in
            Windermere, Florida, USA. These Terms are governed by the laws of the
            State of Florida, United States, without regard to conflict-of-laws
            rules. Questions about these Terms can be sent through the in-app
            contact form or to champagne@perchwerks.com.
          </p>
        </section>
      </div>

      <p className="mt-10 text-xs text-muted-foreground/60">
        Last updated: June 2026
      </p>
    </div>
  );
};

export default Terms;
