// Lightweight, offline disposable-email guard for account sign-up. Not meant to
// be exhaustive (an online list would break offline-first and go stale) — just a
// curated set of the common "5-minute mailbox" providers, plus basic shape
// checks. The server (Supabase auth) remains the real gate.

const DISPOSABLE_DOMAINS = new Set<string>([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "burnermail.io",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "fexbox.org",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "inboxkitten.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "mailsac.com",
  "mailto.plus",
  "minuteinbox.com",
  "mintemail.com",
  "mohmal.com",
  "moakt.com",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "throwawaymail.com",
  "tmpmail.org",
  "trashmail.com",
  "yopmail.com",
  "yopmail.net",
]);

/** The lower-cased domain part of an email, or null if it has no `@`. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/** True if the email's domain is a known disposable / temporary-mail provider. */
export function isDisposableEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain != null && DISPOSABLE_DOMAINS.has(domain);
}

/** Very small structural sanity check (a real validator lives server-side). */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
