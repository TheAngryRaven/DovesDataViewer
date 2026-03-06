import { useState, useRef, useCallback, useEffect } from "react";
import { GpsSample } from "@/types/racing";
import { saveVideoSync, loadVideoSync, VideoSyncRecord } from "@/lib/videoStorage";
import { loadSessionVideo, hasSessionVideo, deleteSessionVideo, getSessionVideoMeta, type StoredVideoMeta } from "@/lib/videoFileStorage";
import type { OverlaySettings } from "@/components/video-overlays/types";
import { DEFAULT_OVERLAY_SETTINGS } from "@/components/video-overlays/types";

interface UseVideoSyncOptions {
  samples: GpsSample[];
  allSamples: GpsSample[];
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
  overlaySettings: OverlaySettings;
  hasStoredVideo: boolean;
  storedVideoMeta: StoredVideoMeta | null;
}

export interface VideoSyncActions {
  loadVideo: () => void;
  toggleLock: () => void;
  togglePlay: () => void;
  stepFrame: (direction: 1 | -1) => void;
  setSyncPoint: () => void;
    seekVideo: (timeSec: number) => void;
    updateOverlaySettings: (settings: OverlaySettings) => void;
    deleteStoredVideo: () => Promise<void>;
    videoRef: React.RefObject<HTMLVideoElement | null>;
  }

function findNearestIndex(samples: GpsSample[], targetMs: number): number {
  if (samples.length === 0) return 0;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < targetMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(samples[lo - 1].t - targetMs) < Math.abs(samples[lo].t - targetMs)) {
    return lo - 1;
  }
  return lo;
}

export function useVideoSync({ samples, allSamples, currentIndex, onScrub, sessionFileName }: UseVideoSyncOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSeekTimeRef = useRef(0);

  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const samplesRef = useRef(samples);
  samplesRef.current = samples;

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);
  const syncOffsetMsRef = useRef(0);
  const [fps, setFps] = useState(30);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isOutOfRange, setIsOutOfRange] = useState(false);
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [overlaySettings, setOverlaySettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [storedVideoAvailable, setStoredVideoAvailable] = useState(false);
  const [storedVideoMeta, setStoredVideoMeta] = useState<StoredVideoMeta | null>(null);

  const revokeUrl = useCallback(() => {
    setVideoUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  useEffect(() => revokeUrl, [revokeUrl]);

  // Restore persisted sync state + auto-load video from IndexedDB
  useEffect(() => {
    if (!sessionFileName) return;

    // Check if there's a stored video and load metadata
    hasSessionVideo(sessionFileName).then(has => setStoredVideoAvailable(has));
    getSessionVideoMeta(sessionFileName).then(meta => setStoredVideoMeta(meta)).catch(() => {});

    loadVideoSync(sessionFileName).then(async (record) => {
      if (!record) {
        // No sync record, but check for stored video anyway
        await tryLoadStoredVideo(sessionFileName);
        return;
      }
      syncOffsetMsRef.current = record.syncOffsetMs;
      setSyncOffsetMs(record.syncOffsetMs);
      setVideoFileName(record.videoFileName);
      if (record.isLocked !== undefined) setIsLocked(record.isLocked);
      if (record.overlaySettings) setOverlaySettings(record.overlaySettings);

      // Try FileSystemFileHandle first
      let loaded = false;
      if (record.fileHandle) {
        try {
          const permission = await (record.fileHandle as any).queryPermission({ mode: "read" });
          if (permission === "granted") {
            const file = await record.fileHandle.getFile();
            const url = URL.createObjectURL(file);
            setVideoUrl(url);
            setFileHandle(record.fileHandle);
            loaded = true;
          }
        } catch {}
      }

      // Fallback: load from IndexedDB stored video
      if (!loaded) {
        await tryLoadStoredVideo(sessionFileName);
      }
    });
  }, [sessionFileName]);

  const tryLoadStoredVideo = useCallback(async (fileName: string) => {
    try {
      const stored = await loadSessionVideo(fileName);
      if (stored) {
        const url = URL.createObjectURL(stored.blob);
        setVideoUrl(url);
        setVideoFileName(stored.videoFileName);
        setStoredVideoAvailable(true);
        setStoredVideoMeta(stored.meta);
      }
    } catch (e) {
      console.error("Failed to load stored video:", e);
    }
  }, []);

  // Persist sync state
  const persistSync = useCallback((offset: number, handle?: FileSystemFileHandle, fileName?: string, locked?: boolean) => {
    if (!sessionFileName) return;
    const record: VideoSyncRecord = {
      sessionFileName,
      syncOffsetMs: offset,
      videoFileName: fileName || videoFileName || "",
      fileHandle: handle || fileHandle || undefined,
      isLocked: locked ?? isLocked,
      overlaySettings,
    };
    saveVideoSync(record);
  }, [sessionFileName, videoFileName, fileHandle, isLocked, overlaySettings]);

  // Load video file
  const loadVideo = useCallback(async () => {
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
        persistSync(syncOffsetMsRef.current, handle, file.name);
        return;
      } catch (e: any) {
        if (e.name === "AbortError") return;
      }
    }
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
      persistSync(syncOffsetMsRef.current, undefined, file.name);
      input.value = "";
    };
    input.click();
  }, [revokeUrl, persistSync]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoDuration(video.duration);
  }, []);

  // Detect FPS
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
          if (delta > 0 && delta < 0.2) {
            frameTimes.push(delta);
            frameCount++;
            if (frameCount >= 10) {
              const avgDelta = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
              const detectedFps = Math.round(1 / avgDelta);
              if (detectedFps > 0 && detectedFps <= 120) setFps(detectedFps);
              return;
            }
          }
        }
        lastTime = metadata.mediaTime;
        (video as any).requestVideoFrameCallback(callback);
      };
      const origPaused = video.paused;
      if (origPaused) {
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

  // Video-drives-data
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
        const s = samplesRef.current;
        const idx = findNearestIndex(s, telemetryMs);
        const outOfRange = s.length === 0 || telemetryMs < s[0].t || telemetryMs > s[s.length - 1].t;
        onScrubRef.current(idx);
        setVideoCurrentTime(v.currentTime);
        setIsOutOfRange(outOfRange);
        if (active) (v as any).requestVideoFrameCallback(callback);
      };
      (video as any).requestVideoFrameCallback(callback);
    } else {
      let lastRaf = 0;
      const loop = (ts: number) => {
        if (!active) return;
        if (ts - lastRaf < 33) { requestAnimationFrame(loop); return; }
        lastRaf = ts;
        const v = videoRef.current;
        if (!v) return;
        const videoMs = v.currentTime * 1000;
        const telemetryMs = videoMs + syncOffsetMs;
        const s = samplesRef.current;
        const idx = findNearestIndex(s, telemetryMs);
        const outOfRange = s.length === 0 || telemetryMs < s[0].t || telemetryMs > s[s.length - 1].t;
        onScrubRef.current(idx);
        setVideoCurrentTime(v.currentTime);
        setIsOutOfRange(outOfRange);
        if (active) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    return () => { active = false; };
  }, [videoUrl, isLocked, isPlaying, syncOffsetMs]);

  // Data-drives-video
  useEffect(() => {
    if (!isLocked || isPlaying) return;
    const video = videoRef.current;
    if (!video || !videoUrl || samples.length === 0) return;
    const now = performance.now();
    if (now - lastSeekTimeRef.current < 50) return;
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
      if (Math.abs(video.currentTime - clampedSec) > 0.5 / fps) {
        video.currentTime = clampedSec;
      }
    }
    setVideoCurrentTime(clampedSec);
  }, [currentIndex, isLocked, isPlaying, syncOffsetMs, samples, videoUrl, fps]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play(); setIsPlaying(true); }
    else { video.pause(); setIsPlaying(false); }
  }, []);

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
    setIsLocked(prev => {
      const next = !prev;
      persistSync(syncOffsetMsRef.current, undefined, undefined, next);
      return next;
    });
  }, [persistSync]);

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
    syncOffsetMsRef.current = offset;
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

  // Update current time when playing unlocked
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

  const handleDeleteStoredVideo = useCallback(async () => {
    if (!sessionFileName) return;
    await deleteSessionVideo(sessionFileName);
    setStoredVideoAvailable(false);
    setStoredVideoMeta(null);
  }, [sessionFileName]);

  const updateOverlaySettings = useCallback((newSettings: OverlaySettings) => {
    setOverlaySettings(newSettings);
    // Persist immediately
    if (sessionFileName) {
      const record: VideoSyncRecord = {
        sessionFileName,
        syncOffsetMs,
        videoFileName: videoFileName || "",
        fileHandle: fileHandle || undefined,
        overlaySettings: newSettings,
      };
      saveVideoSync(record);
    }
  }, [sessionFileName, syncOffsetMs, videoFileName, fileHandle]);

  const state: VideoSyncState = {
    videoUrl, videoFileName, isLocked, isPlaying, syncOffsetMs, fps,
    videoDuration, videoCurrentTime, isOutOfRange, overlaySettings,
    hasStoredVideo: storedVideoAvailable,
    storedVideoMeta,
  };

  const actions: VideoSyncActions = {
    loadVideo, toggleLock, togglePlay, stepFrame, setSyncPoint,
    seekVideo, updateOverlaySettings, deleteStoredVideo: handleDeleteStoredVideo, videoRef,
  };

  return { state, actions, handleLoadedMetadata };
}
