// A paid plan chosen at sign-up can't go straight to Stripe Checkout: sign-up
// requires email confirmation, so there's no session yet. We stash the choice
// here (localStorage) and redirect to Checkout on the user's first authenticated
// load (see usePendingCheckout). The intent expires so a stale choice never
// hijacks a later, unrelated sign-in.

import type { BillingInterval } from "./billing";

const KEY = "dove-pending-checkout";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export interface PendingCheckout {
  tier: string;
  interval: BillingInterval;
  ts: number;
}

/** Parse + validate a stored intent, dropping anything malformed or expired. Pure. */
export function parsePendingCheckout(raw: string | null, now: number): PendingCheckout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingCheckout>;
    if (typeof v.tier !== "string" || v.tier === "free") return null;
    if (v.interval !== "monthly" && v.interval !== "annual") return null;
    if (typeof v.ts !== "number" || now - v.ts > MAX_AGE_MS) return null;
    return { tier: v.tier, interval: v.interval, ts: v.ts };
  } catch {
    return null;
  }
}

export function setPendingCheckout(tier: string, interval: BillingInterval): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tier, interval, ts: Date.now() }));
  } catch {
    /* storage unavailable — checkout just won't auto-resume */
  }
}

export function getPendingCheckout(): PendingCheckout | null {
  try {
    return parsePendingCheckout(localStorage.getItem(KEY), Date.now());
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
