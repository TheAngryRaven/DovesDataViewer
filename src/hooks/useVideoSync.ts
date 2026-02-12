import { useState, useRef, useCallback, useEffect } from "react";
import { GpsSample } from "@/types/racing";
import { saveVideoSync, loadVideoSync, VideoSyncRecord } from "@/lib/videoStorage";

interface UseVideoSyncOptions {
  samples: GpsSample[];
  currentIndex: number;
  onScrub: (index: number) => void;
  sessionFileName: string | null;
}

export interface VideoSyncState {
  videoUrl: string | null;
  videoFileName: string | null;
  isLocked: boolean;
  isPlaying: boolean;
  syncOffsetMs: number;
  fps: number;
  videoDuration: number;
  videoCurrentTime: number;
  isOutOfRange: boolean;
}

export interface VideoSyncActions {
  loadVideo: () => void;
  toggleLock: () => void;
  togglePlay: () => void;
  stepFrame: (direction: 1 | -1) => void;
  setSyncPoint: () => void;
  seekVideo: (timeSec: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

/**
 * Binary search for nearest sample by timestamp.
 */
function findNearestIndex(samples: GpsSample[], targetMs: number): number {
  if (samples.length === 0) return 0;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < targetMs) lo = mid + 1;
    else hi = mid;
  }
  // Check if lo-1 is closer
  if (lo > 0 && Math.abs(samples[lo - 1].t - targetMs) < Math.abs(samples[lo].t - targetMs)) {
    return lo - 1;
  }
  return lo;
}

export function useVideoSync({ samples, currentIndex, onScrub, sessionFileName }: UseVideoSyncOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSeekTimeRef = useRef(0);

  // Refs for values used inside frame callbacks to avoid effect dependency churn
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const samplesRef = useRef(samples);
  samplesRef.current = samples;

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);
  const [fps, setFps] = useState(30);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isOutOfRange, setIsOutOfRange] = useState(false);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);

  // Cleanup object URL on unmount or video change
  const revokeUrl = useCallback(() => {
    setVideoUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  useEffect(() => revokeUrl, [revokeUrl]);

  // Restore persisted sync state
  useEffect(() => {
    if (!sessionFileName) return;
    loadVideoSync(sessionFileName).then(async (record) => {
      if (!record) return;
      setSyncOffsetMs(record.syncOffsetMs);
      setVideoFileName(record.videoFileName);
      // Try restoring file handle (Chromium only)
      if (record.fileHandle) {
        try {
          const permission = await (record.fileHandle as any).queryPermission({ mode: "read" });
          if (permission === "granted") {
            const file = await record.fileHandle.getFile();
            const url = URL.createObjectURL(file);
            setVideoUrl(url);
            setFileHandle(record.fileHandle);
          }
        } catch {
          // Handle not restorable, user will need to re-attach
        }
      }
    });
  }, [sessionFileName]);

  // Persist sync state
  const persistSync = useCallback((offset: number, handle?: FileSystemFileHandle, fileName?: string) => {
    if (!sessionFileName) return;
    const record: VideoSyncRecord = {
      sessionFileName,
      syncOffsetMs: offset,
      videoFileName: fileName || videoFileName || "",
      fileHandle: handle || fileHandle || undefined,
    };
    saveVideoSync(record);
  }, [sessionFileName, videoFileName, fileHandle]);

  // Load video file
  const loadVideo = useCallback(async () => {
    // Try File System Access API first
    if ("showOpenFilePicker" in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: "Video files", accept: { "video/*": [".mp4", ".webm", ".mov", ".mkv", ".avi"] } }],
        });
        const file = await handle.getFile();
        revokeUrl();
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        setVideoFileName(file.name);
        setFileHandle(handle);
        persistSync(syncOffsetMs, handle, file.name);
        return;
      } catch (e: any) {
        if (e.name === "AbortError") return; // User cancelled
      }
    }
    // Fallback: hidden file input
    if (!fileInputRef.current) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*";
      input.style.display = "none";
      document.body.appendChild(input);
      fileInputRef.current = input;
    }
    const input = fileInputRef.current;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      revokeUrl();
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoFileName(file.name);
      persistSync(syncOffsetMs, undefined, file.name);
      input.value = "";
    };
    input.click();
  }, [revokeUrl, syncOffsetMs, persistSync]);

  // Video metadata loaded
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoDuration(video.duration);
  }, []);

  // Detect FPS via requestVideoFrameCallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    if ("requestVideoFrameCallback" in video) {
      let lastTime = 0;
      let frameCount = 0;
      const frameTimes: number[] = [];

      const callback = (_now: number, metadata: any) => {
        if (lastTime > 0) {
          const delta = metadata.mediaTime - lastTime;
          if (delta > 0 && delta < 0.2) { // Ignore large jumps
            frameTimes.push(delta);
            frameCount++;
            if (frameCount >= 10) {
              const avgDelta = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
              const detectedFps = Math.round(1 / avgDelta);
              if (detectedFps > 0 && detectedFps <= 120) setFps(detectedFps);
              return; // Stop after detection
            }
          }
        }
        lastTime = metadata.mediaTime;
        (video as any).requestVideoFrameCallback(callback);
      };

      // Need to play briefly to detect fps
      const origPaused = video.paused;
      if (origPaused) {
        // We'll detect on next actual play
        const onPlay = () => {
          (video as any).requestVideoFrameCallback(callback);
          video.removeEventListener("play", onPlay);
        };
        video.addEventListener("play", onPlay);
        return () => video.removeEventListener("play", onPlay);
      } else {
        (video as any).requestVideoFrameCallback(callback);
      }
    }
  }, [videoUrl]);

  // Video-drives-data: when locked + playing, sync telemetry to video.
  // Uses refs for onScrub/samples to avoid restarting the frame callback
  // chain when those values get new identities.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || !isLocked || !isPlaying) return;

    let active = true;

    if ("requestVideoFrameCallback" in video) {
      const callback = () => {
        if (!active) return;
        const v = videoRef.current;
        if (!v) return;
        const videoMs = v.currentTime * 1000;
        const telemetryMs = videoMs + syncOffsetMs;
        const idx = findNearestIndex(samplesRef.current, telemetryMs);

        onScrubRef.current(idx);
        setVideoCurrentTime(v.currentTime);
        setIsOutOfRange(v.currentTime > v.duration);

        if (active) (v as any).requestVideoFrameCallback(callback);
      };
      (video as any).requestVideoFrameCallback(callback);
    } else {
      // rAF fallback for Firefox — skip frames if behind
      let lastRaf = 0;
      const loop = (ts: number) => {
        if (!active) return;
        // Throttle to ~30fps to reduce overhead
        if (ts - lastRaf < 33) { requestAnimationFrame(loop); return; }
        lastRaf = ts;
        const v = videoRef.current;
        if (!v) return;
        const videoMs = v.currentTime * 1000;
        const telemetryMs = videoMs + syncOffsetMs;
        const idx = findNearestIndex(samplesRef.current, telemetryMs);

        onScrubRef.current(idx);
        setVideoCurrentTime(v.currentTime);
        if (active) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    return () => { active = false; };
  }, [videoUrl, isLocked, isPlaying, syncOffsetMs]);

  // Data-drives-video: when locked, paused, and user scrubs the graph.
  // Guarded by !isPlaying so it never fights the video-drives-data loop.
  useEffect(() => {
    if (!isLocked || isPlaying) return;
    const video = videoRef.current;
    if (!video || !videoUrl || samples.length === 0) return;

    const now = performance.now();
    if (now - lastSeekTimeRef.current < 50) return; // Throttle to ~20 seeks/sec
    lastSeekTimeRef.current = now;

    const sample = samples[currentIndex];
    if (!sample) return;

    const videoSec = (sample.t - syncOffsetMs) / 1000;
    const clampedSec = Math.max(0, videoSec);

    if (videoSec < 0 || videoSec > video.duration) {
      setIsOutOfRange(true);
      if (!video.paused) video.pause();
    } else {
      setIsOutOfRange(false);
      // Only seek if the difference is meaningful (> half a frame)
      if (Math.abs(video.currentTime - clampedSec) > 0.5 / fps) {
        video.currentTime = clampedSec;
      }
    }
    setVideoCurrentTime(clampedSec);
  }, [currentIndex, isLocked, isPlaying, syncOffsetMs, samples, videoUrl, fps]);

  // Play/pause sync
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  // Listen for video ending
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPause = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("play", onPlay);
    };
  }, [videoUrl]);

  const toggleLock = useCallback(() => {
    setIsLocked(prev => !prev);
  }, []);

  const stepFrame = useCallback((direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video || isLocked) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + direction / fps));
    setVideoCurrentTime(video.currentTime);
  }, [fps, isLocked]);

  const setSyncPoint = useCallback(() => {
    const video = videoRef.current;
    if (!video || samples.length === 0) return;
    const videoMs = video.currentTime * 1000;
    const telemetryMs = samples[currentIndex]?.t ?? 0;
    const offset = telemetryMs - videoMs;
    setSyncOffsetMs(offset);
    persistSync(offset);
  }, [samples, currentIndex, persistSync]);

  const seekVideo = useCallback((timeSec: number) => {
    const video = videoRef.current;
    if (!video || isLocked) return;
    const clampedTime = Math.max(0, Math.min(video.duration || Infinity, timeSec));
    video.currentTime = clampedTime;
    setVideoCurrentTime(clampedTime);
  }, [isLocked]);

  // Update current time periodically when playing unlocked
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying || isLocked) return;
    let active = true;
    const update = () => {
      if (!active) return;
      setVideoCurrentTime(video.currentTime);
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
    return () => { active = false; };
  }, [isPlaying, isLocked, videoUrl]);

  const state: VideoSyncState = {
    videoUrl,
    videoFileName,
    isLocked,
    isPlaying,
    syncOffsetMs,
    fps,
    videoDuration,
    videoCurrentTime,
    isOutOfRange,
  };

  const actions: VideoSyncActions = {
    loadVideo,
    toggleLock,
    togglePlay,
    stepFrame,
    setSyncPoint,
    seekVideo,
    videoRef,
  };

  return { state, actions, handleLoadedMetadata };
}
