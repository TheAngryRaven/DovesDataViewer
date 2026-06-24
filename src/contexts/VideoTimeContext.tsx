import { createContext, useContext } from 'react';

/**
 * The synced video's current playhead time, deliberately split out of
 * SessionContext (and out of the memoized VideoSyncState): while a locked video
 * plays it advances every video frame, and a context update re-renders every
 * consumer regardless of memo(). With it in its own tiny context, only the
 * component that actually displays the playhead (the VideoPlayer's progress bar
 * + time readout) re-renders per frame — VideoSyncState stays referentially
 * stable, so the session tree and memo'd tabs stay quiet during playback. Same
 * rationale as PlaybackContext.
 */
export interface VideoTimeContextValue {
  /** Virtual (whole-recording) time of the current frame, in seconds. */
  videoCurrentTime: number;
}

const VideoTimeContext = createContext<VideoTimeContextValue | null>(null);

export function VideoTimeProvider({
  children, value,
}: { children: React.ReactNode; value: VideoTimeContextValue }) {
  return <VideoTimeContext.Provider value={value}>{children}</VideoTimeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook conventionally co-located with its provider
export function useVideoTime(): VideoTimeContextValue {
  const ctx = useContext(VideoTimeContext);
  if (!ctx) throw new Error('useVideoTime must be used within VideoTimeProvider');
  return ctx;
}
