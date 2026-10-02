// Build-time helpers for the offline "deferred asset" directories (plan 0027):
// the big public/ folders held out of the service-worker precache and runtime-
// cached instead. `vite.config.ts` feeds the one list below into the precache
// `globIgnores`, the emitted manifest AND the runtime-cache route, so adding a
// directory can never leave the three disagreeing.
//
// Pure build tooling (Node, runs in `vite build`), never shipped to the client.

/** `public/` subdirectories served from the runtime cache instead of the precache. */
export const DEFERRED_ASSET_DIRS = ["samples", "loggers"] as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Pathname test for "is this under one of `dirs`" — e.g. `/^\/(?:samples|loggers)\//`. */
export function deferredAssetPathPattern(dirs: readonly string[]): RegExp {
  return new RegExp(`^\\/(?:${dirs.map(escapeRegExp).join("|")})\\/`);
}

export type SameOriginRouteMatcher = (ctx: { url: URL; sameOrigin: boolean }) => boolean;

/**
 * A Workbox `urlPattern` callback matching same-origin requests whose pathname
 * fits `pattern`. workbox-build serializes the callback into the generated
 * worker with `Function.prototype.toString`, where nothing from this module's
 * scope survives — so the regex is spliced into the function's SOURCE as a
 * literal instead of being captured by a closure.
 */
export function sameOriginPathMatcher(pattern: RegExp): SameOriginRouteMatcher {
  return new Function(
    "{ url, sameOrigin }",
    `return sameOrigin && ${pattern.toString()}.test(url.pathname);`,
  ) as SameOriginRouteMatcher;
}
