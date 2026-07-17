/**
 * Host-level "is the user in the middle of something?" signal.
 *
 * main.tsx's update flow lives outside the React tree, but whether an
 * update may auto-apply depends on app state (a loaded session must
 * never be yanked out from under the user). Index.tsx flips this flag
 * as its session state changes; anything outside React reads it.
 * Same host pub/sub idiom as fileLoadingState.ts.
 */

let sessionActive = false;

export function setSessionActive(active: boolean): void {
  sessionActive = active;
}

export function isSessionActive(): boolean {
  return sessionActive;
}
