import type { NavigateFunction } from "react-router-dom";

/**
 * "Back to app" navigation that returns the user to wherever they came from.
 *
 * React Router stamps an incrementing `idx` onto `history.state` for every
 * in-app navigation. When `idx > 0` there's a prior in-app entry to return to,
 * so we step back one (preserving its scroll/form state). When it's 0 the page
 * was reached directly — a fresh tab, a bookmark, or an external link — and
 * there's nothing in-app to go back to, so we fall back to the home route.
 */
export function goBackOrHome(
  navigate: NavigateFunction,
  history: { state?: unknown } = typeof window !== "undefined" ? window.history : {},
): void {
  const idx = (history.state as { idx?: number } | null | undefined)?.idx ?? 0;
  if (idx > 0) {
    navigate(-1);
  } else {
    navigate("/");
  }
}
