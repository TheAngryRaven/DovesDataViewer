/**
 * The native video store's change event (plan 0024), split from
 * `nativeVideoStore.ts` so eager listeners (`useVideoSync`) can subscribe
 * without pulling the store's IPC bridge into the main chunk.
 *
 * Fired on `window` after a stored video is removed or the store is cleared,
 * so a session that is playing (or exporting) from the deleted copy can react.
 * `removedKeys` is `null` when everything went.
 */
export const NATIVE_VIDEO_STORE_CHANGED = "native-video-store-changed";
export interface NativeVideoStoreChangedDetail {
  removedKeys: string[] | null;
}
