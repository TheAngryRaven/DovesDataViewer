import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { GpsSample } from "@/types/racing";
import { saveVideoSync, loadVideoSync, VideoSyncRecord, VideoSyncChunk } from "@/lib/videoStorage";
import { loadSessionVideo, hasSessionVideo, deleteSessionVideo, getSessionVideoMeta, type StoredVideoMeta } from "@/lib/videoFileStorage";
import type { OverlaySettings } from "@/components/video-overlays/types";
import { DEFAULT_OVERLAY_SETTINGS } from "@/components/video-overlays/types";
import { findNearestIndex } from "@/components/video-overlays/overlayUtils";
import { coverageOf, sessionMsToVideoSec, videoSecToSessionMs, fitVideoTimeline, videoSlaveAction, resyncThresholdSec, needsResync, type VideoCoverage } from "@/lib/videoTimeline";
import { buildPlaylist, groupVideoRecordings, virtualToLocal, localToVirtual, type Playlist, type VideoRecording } from "@/lib/videoPlaylist";

interface UseVideoSyncOptions {
  samples: GpsSample[];
  allSamples: GpsSample[];
  currentIndex: number;
  onScrub: (index: number) => void;
  sessionFileName: string | null;
  /**
   * Whether the telemetry cursor is being PLAYED by the top play button. When
   * true and the video is locked, the video plays natively as a drift-corrected
   * slave instead of being seek-scrubbed once per cursor tick (which stutters).
   */
  dataIsPlaying: boolean;
}

export interface VideoSyncState {
  videoUrl: string | null;
  /** Object URL of the next chunk, preloaded by a hidden <video> for a near-seamless boundary. */
  preloadUrl: string | null;
  videoFileName: string | null;
  isLocked: boolean;
  isPlaying: boolean;
  syncOffsetMs: number;
  /** Camera/datalogger clock-rate ratio (1 = clocks tick together). */
  syncRate: number;
  /** Number of per-lap calibration anchors currently feeding the rate fit. */
  rateAnchorCount: number;
  fps: number;
  /** Virtual (whole-recording) duration in seconds — sum of all chunks. */
  videoDuration: number;
  /** Number of chunks in the playlist (1 for a single file). */
  chunkCount: number;
  /** Index of the currently-playing chunk. */
  currentChunkIndex: number;
  /** Chunk descriptors (url + virtual offsets) for video export across chunks. */
  exportChunks: { url: string; startOffsetSec: number; durationSec: number }[];
  isOutOfRange: boolean;
  /** Where the cursor sits relative to the footage: 'before' it starts,
   *  'covered', or 'after' it ends (partial-video aware). */
  coverage: VideoCoverage;
  overlaySettings: OverlaySettings;
  hasStoredVideo: boolean;
  storedVideoMeta: StoredVideoMeta | null;
  /**
   * When a selection holds several distinct recordings, the choices to prompt
   * the user with (null = no prompt pending). Each is one recording's display
   * label + chapter count; only the chosen one is ever loaded into memory.
   */
  pendingRecordings: { key: string; label: string; count: number }[] | null;
}

export interface VideoSyncActions {
  loadVideo: () => void;
  /** Load one of the prompted recordings; the others are dropped from memory. */
  chooseRecording: (key: string) => void;
  /** Dismiss the recording prompt without loading anything. */
  cancelRecordingChoice: () => void;
  toggleLock: () => void;
  togglePlay: () => void;
  stepFrame: (direction: 1 | -1) => void;
  setSyncPoint: () => void;
  /** Add/update a per-lap rate-calibration anchor (from the comparison nudge). */
  addRateAnchor: (lap: number, sessionMs: number, videoSec: number) => void;
  /** Clear all per-lap rate calibration (back to pure offset). */
  clearRateAnchors: () => void;
    seekVideo: (timeSec: number) => void;
    updateOverlaySettings: (settings: OverlaySettings) => void;
    deleteStoredVideo: () => Promise<void>;
    refreshStoredMeta: () => Promise<void>;
    videoRef: React.RefObject<HTMLVideoElement>;
    preloadVideoRef: React.RefObject<HTMLVideoElement>;
  }

/** A picked video file held in memory while a recording prompt is pending. */
interface SelectedVideoFile {
  name: string;
  file: File;
  handle?: FileSystemFileHandle;
}

/** Entry describing one chunk before it's turned into a playlist. */
interface ChunkEntry {
  name: string;
  url: string;
  handle?: FileSystemFileHandle;
  /** Known duration (from a restored record); read from the file when absent. */
  durationSec?: number;
}

/**
 * Seek a video element, preferring `fastSeek` (approximate seek, no decode
 * stall) when the browser supports it — smoother for scrub + drift correction.
 */
function seekVideoElement(video: HTMLVideoElement, timeSec: number): void {
  const fast = (video as HTMLVideoElement & { fastSeek?: (t: number) => void }).fastSeek;
  try {
    if (typeof fast === "function") fast.call(video, timeSec);
    else video.currentTime = timeSec;
  } catch { /* out-of-range time is clamped by the browser */ }
}

/** Read a video file's duration via a throwaway metadata-only element. */
function readVideoDuration(url: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      v.removeAttribute("src");
      v.load();
      resolve(d);
    };
    v.addEventListener("loadedmetadata", done, { once: true });
    v.addEventListener("error", done, { once: true });
    // Guard: never hang the load if metadata never arrives.
    setTimeout(done, 5000);
    v.src = url;
  });
}

export function useVideoSync({ samples, allSamples, currentIndex, onScrub, sessionFileName, dataIsPlaying }: UseVideoSyncOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSeekTimeRef = useRef(0);

  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const samplesRef = useRef(samples);
  samplesRef.current = samples;
  // The cursor index, readable from the rAF slave loop without re-subscribing it
  // every tick (it advances at playback rate while the loop runs).
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [preloadUrl, setPreloadUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [syncOffsetMs, setSyncOffsetMs] = useState(0);
  const syncOffsetMsRef = useRef(0);
  // Camera/datalogger clock-rate ratio + the anchors it's fit from. The primary
  // anchor is the user's sync point; extra anchors (one per fine-aligned lap)
  // refine the rate via fitVideoTimeline. Rate 1 = legacy pure-offset behaviour.
  const [syncRate, setSyncRate] = useState(1);
  const syncRateRef = useRef(1);
  const [rateAnchorCount, setRateAnchorCount] = useState(0);
  const syncAnchorRef = useRef<{ sessionMs: number; videoSec: number } | null>(null);
  const lapAnchorsRef = useRef<Map<number, { sessionMs: number; videoSec: number }>>(new Map());
  const [fps, setFps] = useState(30);
  // Read by the slave-playback rAF loop without re-subscribing it: fps is
  // auto-detected ~0.3s into playback, and a dep change there would tear down +
  // resume the loop (a visible hitch) mid-play.
  const fpsRef = useRef(30);
  fpsRef.current = fps;
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [chunkCount, setChunkCount] = useState(1);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [exportChunks, setExportChunks] = useState<{ url: string; startOffsetSec: number; durationSec: number }[]>([]);
  const [isOutOfRange, setIsOutOfRange] = useState(false);
  const [coverage, setCoverage] = useState<VideoCoverage>('covered');
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [overlaySettings, setOverlaySettings] = useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [storedVideoAvailable, setStoredVideoAvailable] = useState(false);
  const [storedVideoMeta, setStoredVideoMeta] = useState<StoredVideoMeta | null>(null);
  // Recording-picker state: when a selection holds >1 recording we hold the
  // grouped File objects in a ref (heavy) and mirror just the labels to state
  // (for rendering). Choosing one drops the ref so the rest are GC'd.
  const pendingGroupsRef = useRef<VideoRecording<SelectedVideoFile>[] | null>(null);
  const [pendingRecordings, setPendingRecordings] =
    useState<{ key: string; label: string; count: number }[] | null>(null);

  // Playlist model + per-chunk resources (refs so the sync loops read them
  // without re-subscribing every render).
  const playlistRef = useRef<Playlist | null>(null);
  const chunkUrlsRef = useRef<string[]>([]);
  const chunkHandlesRef = useRef<(FileSystemFileHandle | undefined)[]>([]);
  const chunkNamesRef = useRef<string[]>([]);
  const currentChunkIndexRef = useRef(0);
  // Guards the async <video> src swap so a superseded swap can't apply its seek.
  const swapTokenRef = useRef(0);
  const pendingActionRef = useRef<{ seekLocalSec: number; play: boolean; token: number } | null>(null);

  // Revoke every chunk URL and clear the playlist.
  const revokeAllUrls = useCallback(() => {
    chunkUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* already revoked */ } });
    chunkUrlsRef.current = [];
    setVideoUrl(null);
    setPreloadUrl(null);
  }, []);

  useEffect(() => () => revokeAllUrls(), [revokeAllUrls]);

  // Switch the active <video> to a chunk, optionally seeking + resuming there.
  // The seek/play is deferred to handleLoadedMetadata (the new src must load
  // first); a swap token discards a swap the user has already superseded.
  const loadChunk = useCallback((index: number, seekLocalSec: number, play: boolean) => {
    const urls = chunkUrlsRef.current;
    if (index < 0 || index >= urls.length) return;
    const token = ++swapTokenRef.current;
    pendingActionRef.current = { seekLocalSec, play, token };
    currentChunkIndexRef.current = index;
    setCurrentChunkIndex(index);
    setVideoUrl(urls[index]);
    setPreloadUrl(urls[index + 1] ?? null);
  }, []);

  // Build a playlist from ordered chunk entries and make chunk 0 active.
  const applyPlaylist = useCallback(async (entries: ChunkEntry[]) => {
    if (entries.length === 0) return;
    const durations = await Promise.all(
      entries.map((e) => (e.durationSec != null ? Promise.resolve(e.durationSec) : readVideoDuration(e.url))),
    );
    const playlist = buildPlaylist(entries.map((e, i) => ({ name: e.name, durationSec: durations[i] })));
    playlistRef.current = playlist;
    chunkUrlsRef.current = entries.map((e) => e.url);
    chunkHandlesRef.current = entries.map((e) => e.handle);
    chunkNamesRef.current = entries.map((e) => e.name);
    currentChunkIndexRef.current = 0;
    swapTokenRef.current++;
    pendingActionRef.current = null;
    setChunkCount(entries.length);
    setCurrentChunkIndex(0);
    setExportChunks(entries.map((e, i) => ({
      url: e.url,
      startOffsetSec: playlist.chunks[i].startOffsetSec,
      durationSec: playlist.chunks[i].durationSec,
    })));
    setVideoDuration(playlist.totalDuration);
    setVideoCurrentTime(0);
    setVideoUrl(entries[0].url);
    setPreloadUrl(entries[1]?.url ?? null);
    setVideoFileName(entries[0].name);
    setFileHandle(entries[0].handle ?? null);
  }, []);

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
      syncRateRef.current = record.syncRate ?? 1;
      setSyncRate(record.syncRate ?? 1);
      // Legacy records carry no anchor; pivot future calibration on footage start
      // (a valid point on the rate-1 line: videoSec 0 ↔ sessionMs = offset).
      syncAnchorRef.current = record.syncAnchor ?? { sessionMs: record.syncOffsetMs, videoSec: 0 };
      lapAnchorsRef.current = new Map(
        (record.rateAnchors ?? []).map((a) => [a.lap, { sessionMs: a.sessionMs, videoSec: a.videoSec }]),
      );
      setRateAnchorCount(lapAnchorsRef.current.size);
      setVideoFileName(record.videoFileName);
      if (record.isLocked !== undefined) setIsLocked(record.isLocked);
      if (record.overlaySettings) setOverlaySettings(record.overlaySettings);

      // Prefer a multi-chunk playlist when the record carries one.
      if (record.chunks && record.chunks.length > 0) {
        const restored = await restoreChunksFromHandles(record.chunks);
        if (restored) return;
      }

      // Single-file FileSystemFileHandle path.
      let loaded = false;
      if (record.fileHandle) {
        try {
          const permission = await record.fileHandle.queryPermission({ mode: "read" });
          if (permission === "granted") {
            const file = await record.fileHandle.getFile();
            revokeAllUrls();
            await applyPlaylist([{ name: record.videoFileName || file.name, url: URL.createObjectURL(file), handle: record.fileHandle }]);
            loaded = true;
          }
        } catch { /* File System Access query failed; fall through to IDB stored video */ }
      }

      // Fallback: load from IndexedDB stored video
      if (!loaded) {
        await tryLoadStoredVideo(sessionFileName);
      }
    });
    // `tryLoadStoredVideo`/`restoreChunksFromHandles` are declared after this
    // effect; including them in deps would TDZ-throw on render. They're stable
    // (empty-deps useCallback) so the closure resolves them at effect-run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionFileName]);

  // Re-grant a restored playlist's file handles and rebuild it (durations are
  // stored, so no metadata re-read). Returns false if any handle is unavailable.
  const restoreChunksFromHandles = useCallback(async (chunks: VideoSyncChunk[]): Promise<boolean> => {
    const entries: ChunkEntry[] = [];
    for (const c of chunks) {
      if (!c.fileHandle) return false;
      try {
        const permission = await c.fileHandle.queryPermission({ mode: "read" });
        if (permission !== "granted") return false;
        const file = await c.fileHandle.getFile();
        entries.push({ name: c.fileName, url: URL.createObjectURL(file), handle: c.fileHandle, durationSec: c.durationSec });
      } catch {
        return false;
      }
    }
    revokeAllUrls();
    await applyPlaylist(entries);
    return true;
  }, [revokeAllUrls, applyPlaylist]);

  const tryLoadStoredVideo = useCallback(async (fileName: string) => {
    try {
      const stored = await loadSessionVideo(fileName);
      if (stored) {
        revokeAllUrls();
        await applyPlaylist([{ name: stored.videoFileName, url: URL.createObjectURL(stored.blob) }]);
        setStoredVideoAvailable(true);
        setStoredVideoMeta(stored.meta);
      }
    } catch (e) {
      console.error("Failed to load stored video:", e);
    }
  }, [revokeAllUrls, applyPlaylist]);

  // Persist sync state
  const persistSync = useCallback((offset: number, handle?: FileSystemFileHandle, fileName?: string, locked?: boolean) => {
    if (!sessionFileName) return;
    const playlist = playlistRef.current;
    const chunks: VideoSyncChunk[] | undefined = chunkNamesRef.current.length > 0
      ? chunkNamesRef.current.map((name, i) => ({
          fileName: name,
          fileHandle: chunkHandlesRef.current[i],
          durationSec: playlist?.chunks[i]?.durationSec ?? 0,
        }))
      : undefined;
    const record: VideoSyncRecord = {
      sessionFileName,
      syncOffsetMs: offset,
      syncRate: syncRateRef.current,
      syncAnchor: syncAnchorRef.current ?? undefined,
      rateAnchors: [...lapAnchorsRef.current.entries()].map(([lap, a]) => ({ lap, ...a })),
      videoFileName: fileName || videoFileName || "",
      fileHandle: handle || chunkHandlesRef.current[0] || fileHandle || undefined,
      isLocked: locked ?? isLocked,
      overlaySettings,
      chunks,
    };
    saveVideoSync(record);
  }, [sessionFileName, videoFileName, fileHandle, isLocked, overlaySettings]);

  // Recompute the offset + rate from the current anchors and apply them to
  // state/refs. Returns the new offset so callers can persist immediately.
  const refitTimeline = useCallback(() => {
    const { syncOffsetMs: off, syncRate: rate } = fitVideoTimeline(
      syncAnchorRef.current,
      [...lapAnchorsRef.current.values()],
    );
    syncOffsetMsRef.current = off;
    syncRateRef.current = rate;
    setSyncOffsetMs(off);
    setSyncRate(rate);
    setRateAnchorCount(lapAnchorsRef.current.size);
    return off;
  }, []);

  // Build the playlist from one chosen recording's files (creates the object
  // URLs only for these — the other recordings in a selection never get one).
  const loadRecording = useCallback(async (recording: VideoRecording<SelectedVideoFile>) => {
    revokeAllUrls();
    await applyPlaylist(recording.files.map((e) => ({
      name: e.name,
      url: URL.createObjectURL(e.file),
      handle: e.handle,
    })));
    persistSync(syncOffsetMsRef.current);
  }, [revokeAllUrls, applyPlaylist, persistSync]);

  // Group a fresh selection into recordings: load straight away when there's
  // exactly one, otherwise stash them and prompt the user to pick.
  const handleSelectedFiles = useCallback(async (selected: SelectedVideoFile[]) => {
    const groups = groupVideoRecordings(selected);
    if (groups.length === 0) return;
    if (groups.length === 1) {
      pendingGroupsRef.current = null;
      setPendingRecordings(null);
      await loadRecording(groups[0]);
      return;
    }
    pendingGroupsRef.current = groups;
    setPendingRecordings(groups.map((g) => ({ key: g.key, label: g.label, count: g.files.length })));
  }, [loadRecording]);

  // Load the picked recording; clearing the ref drops every other recording's
  // File objects so they're freed from memory.
  const chooseRecording = useCallback((key: string) => {
    const group = pendingGroupsRef.current?.find((g) => g.key === key);
    pendingGroupsRef.current = null;
    setPendingRecordings(null);
    if (group) void loadRecording(group);
  }, [loadRecording]);

  // Dismiss the prompt and drop all the held selections from memory.
  const cancelRecordingChoice = useCallback(() => {
    pendingGroupsRef.current = null;
    setPendingRecordings(null);
  }, []);

  // Load video file(s) — supports selecting multiple GoPro chunks at once. A
  // selection spanning several recordings prompts the user to choose one.
  const loadVideo = useCallback(async () => {
    if ("showOpenFilePicker" in window) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          excludeAcceptAllOption: true,
          types: [{
            description: "Video files",
            accept: {
              "video/mp4": [".mp4", ".m4v"],
              "video/quicktime": [".mov"],
              "video/webm": [".webm"],
              "video/x-matroska": [".mkv"],
              "video/x-msvideo": [".avi"],
            },
          }],
        });
        const files = await Promise.all(handles.map((h) => h.getFile()));
        await handleSelectedFiles(files.map((f, i) => ({ name: f.name, file: f, handle: handles[i] })));
        return;
      } catch (e) {
        // User cancelled the file picker — DOMException("AbortError"). Swallow.
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    if (!fileInputRef.current) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi";
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      fileInputRef.current = input;
    }
    const input = fileInputRef.current;
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      input.value = "";
      if (files.length === 0) return;
      await handleSelectedFiles(files.map((f) => ({ name: f.name, file: f })));
    };
    input.click();
  }, [handleSelectedFiles]);

  // After a chunk's metadata loads, apply any pending seek/play and refresh time.
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const pending = pendingActionRef.current;
    if (pending && pending.token === swapTokenRef.current) {
      pendingActionRef.current = null;
      try { video.currentTime = pending.seekLocalSec; } catch { /* clamped by browser */ }
      if (pending.play) video.play().catch(() => {});
    }
    const pl = playlistRef.current;
    if (pl) setVideoCurrentTime(localToVirtual(pl, currentChunkIndexRef.current, video.currentTime));
  }, []);

  // Auto-advance to the next chunk when the active one ends during playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    const onEnded = () => {
      const idx = currentChunkIndexRef.current;
      if (idx < chunkUrlsRef.current.length - 1) {
        loadChunk(idx + 1, 0, true);
      } else {
        setIsPlaying(false);
      }
    };
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [videoUrl, loadChunk]);

  // Detect FPS
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if ("requestVideoFrameCallback" in video) {
      let lastTime = 0;
      let frameCount = 0;
      const frameTimes: number[] = [];
      const callback = (_now: number, metadata: VideoFrameCallbackMetadata) => {
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
        video.requestVideoFrameCallback(callback);
      };
      const origPaused = video.paused;
      if (origPaused) {
        const onPlay = () => {
          video.requestVideoFrameCallback(callback);
          video.removeEventListener("play", onPlay);
        };
        video.addEventListener("play", onPlay);
        return () => video.removeEventListener("play", onPlay);
      } else {
        video.requestVideoFrameCallback(callback);
      }
    }
  }, [videoUrl]);

  // Video-drives-data (locked + playing via the VIDEO's own controls): map the
  // active chunk's local time to virtual time, then to telemetry. When the top
  // play button is the one driving (dataIsPlaying), the data clock owns the
  // cursor instead — see the slave-playback effect below — so this yields.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl || !isLocked || !isPlaying || dataIsPlaying) return;
    let active = true;
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const pl = playlistRef.current;
      const total = pl ? pl.totalDuration : v.duration;
      const virtualSec = pl ? localToVirtual(pl, currentChunkIndexRef.current, v.currentTime) : v.currentTime;
      const telemetryMs = videoSecToSessionMs(virtualSec, syncOffsetMs, syncRate);
      const s = samplesRef.current;
      const idx = findNearestIndex(s, telemetryMs);
      onScrubRef.current(idx);
      setVideoCurrentTime(virtualSec);
      setCoverage(coverageOf(telemetryMs, syncOffsetMs, total, syncRate));
      // The footage may run past the end of the session (camera stopped after
      // the logger). We don't play video past the session — pause at the last
      // sample instead of rolling on into uncaptured time.
      if (s.length > 0 && telemetryMs > s[s.length - 1].t) {
        setIsOutOfRange(true);
        if (!v.paused) { v.pause(); setIsPlaying(false); }
      } else {
        setIsOutOfRange(false);
      }
    };
    if ("requestVideoFrameCallback" in video) {
      const callback = () => {
        if (!active) return;
        tick();
        if (active) videoRef.current?.requestVideoFrameCallback(callback);
      };
      video.requestVideoFrameCallback(callback);
    } else {
      let lastRaf = 0;
      const loop = (ts: number) => {
        if (!active) return;
        if (ts - lastRaf < 33) { requestAnimationFrame(loop); return; }
        lastRaf = ts;
        tick();
        if (active) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    return () => { active = false; };
  }, [videoUrl, isLocked, isPlaying, dataIsPlaying, syncOffsetMs, syncRate]);

  // Data-drives-video SLAVE (locked + the top play button is playing): keep the
  // video playing NATIVELY and only nudge it back into alignment when it drifts
  // past a couple of frames — never seek per cursor tick. The telemetry cursor
  // stays the single authority (usePlayback's rAF advances it); the video is a
  // drift-corrected follower. This is what kills the seek-scrub stutter.
  //
  // The loop is rAF (not requestVideoFrameCallback) so it keeps ticking while
  // the cursor crosses an uncovered gap with the video paused — rVFC would stop
  // firing there and never notice the cursor re-entering footage.
  useEffect(() => {
    if (!isLocked || !dataIsPlaying) return;
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    let active = true;
    const tick = () => {
      if (!active) return;
      const v = videoRef.current;
      if (!v) { return; }
      const pl = playlistRef.current;
      const total = pl ? pl.totalDuration : v.duration;
      const s = samplesRef.current;
      const sample = s[currentIndexRef.current];
      if (sample) {
        const cov = coverageOf(sample.t, syncOffsetMs, total, syncRate);
        setCoverage(cov);
        const action = videoSlaveAction({ isLocked: true, dataIsPlaying: true, hasVideo: true, coverage: cov });
        if (action === 'play') {
          setIsOutOfRange(false);
          const targetVirtual = Math.max(0, sessionMsToVideoSec(sample.t, syncOffsetMs, syncRate));
          const { index, localSec } = pl ? virtualToLocal(pl, targetVirtual) : { index: 0, localSec: targetVirtual };
          if (pl && index !== currentChunkIndexRef.current) {
            // Crossed a chunk boundary (or jumped chunks): swap + resume there.
            loadChunk(index, localSec, true);
          } else if (v.paused) {
            // Entering footage (start of play, or after a gap): align once, then
            // let it play natively from here.
            try { v.currentTime = localSec; } catch { /* clamped by browser */ }
            v.play().catch(() => {});
          } else if (needsResync(v.currentTime, localSec, resyncThresholdSec(fpsRef.current))) {
            // Playing: correct drift only past the threshold (a couple frames).
            seekVideoElement(v, localSec);
          }
          if (!v.paused) setVideoCurrentTime(pl ? localToVirtual(pl, currentChunkIndexRef.current, v.currentTime) : v.currentTime);
        } else {
          // 'hold' — no footage here: blank + pause, cursor plays on through.
          setIsOutOfRange(true);
          if (!v.paused) v.pause();
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      active = false;
      // Stop the slave when the cursor stops playing (top pause / end of window).
      if (!video.paused) video.pause();
    };
  }, [isLocked, dataIsPlaying, videoUrl, syncOffsetMs, syncRate, loadChunk]);

  // Data-drives-video SCRUB (locked + everything paused): seek the playlist to
  // the selected sample. Runs only when neither the video nor the data cursor is
  // playing — i.e. the user is scrubbing or parked. Uses fastSeek where it
  // exists; the 50ms gate coalesces a fast drag into a sane seek rate.
  useEffect(() => {
    if (!isLocked || isPlaying || dataIsPlaying) return;
    const video = videoRef.current;
    if (!video || !videoUrl || samples.length === 0) return;
    const pl = playlistRef.current;
    const total = pl ? pl.totalDuration : video.duration;
    const now = performance.now();
    if (now - lastSeekTimeRef.current < 50) return;
    lastSeekTimeRef.current = now;
    const sample = samples[currentIndex];
    if (!sample) return;
    const virtualSec = sessionMsToVideoSec(sample.t, syncOffsetMs, syncRate);
    const clampedSec = Math.max(0, virtualSec);
    const cov = coverageOf(sample.t, syncOffsetMs, total, syncRate);
    setCoverage(cov);
    if (cov !== 'covered') {
      // No footage for this session position — blank it, but the cursor/charts
      // stay free to scrub or play through the gap.
      setIsOutOfRange(true);
      if (!video.paused) video.pause();
    } else {
      setIsOutOfRange(false);
      if (pl) {
        const { index, localSec } = virtualToLocal(pl, clampedSec);
        if (index !== currentChunkIndexRef.current) {
          loadChunk(index, localSec, false);
        } else if (needsResync(video.currentTime, localSec, 0.5 / fps)) {
          seekVideoElement(video, localSec);
        }
      } else if (needsResync(video.currentTime, clampedSec, 0.5 / fps)) {
        seekVideoElement(video, clampedSec);
      }
    }
    setVideoCurrentTime(clampedSec);
  }, [currentIndex, isLocked, isPlaying, dataIsPlaying, syncOffsetMs, syncRate, samples, videoUrl, fps, loadChunk]);

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

  // Current virtual time of the active chunk.
  const currentVirtualTime = useCallback((): number => {
    const video = videoRef.current;
    const pl = playlistRef.current;
    if (!video) return 0;
    return pl ? localToVirtual(pl, currentChunkIndexRef.current, video.currentTime) : video.currentTime;
  }, []);

  // Seek the playlist to a virtual time, swapping chunks if needed.
  const seekToVirtual = useCallback((virtualSec: number, play: boolean) => {
    const pl = playlistRef.current;
    const video = videoRef.current;
    if (!video) return;
    if (pl) {
      const { index, localSec } = virtualToLocal(pl, virtualSec);
      if (index !== currentChunkIndexRef.current) {
        loadChunk(index, localSec, play);
      } else {
        video.currentTime = localSec;
        if (play && video.paused) video.play().catch(() => {});
      }
    } else {
      video.currentTime = virtualSec;
    }
    setVideoCurrentTime(virtualSec);
  }, [loadChunk]);

  const stepFrame = useCallback((direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video || isLocked) return;
    const total = playlistRef.current?.totalDuration ?? video.duration;
    const next = Math.max(0, Math.min(total, currentVirtualTime() + direction / fps));
    seekToVirtual(next, false);
  }, [fps, isLocked, currentVirtualTime, seekToVirtual]);

  const setSyncPoint = useCallback(() => {
    const video = videoRef.current;
    if (!video || samples.length === 0) return;
    const telemetryMs = samples[currentIndex]?.t ?? 0;
    // A fresh manual sync becomes the primary anchor and invalidates any prior
    // per-lap rate calibration (it was relative to the old anchor).
    syncAnchorRef.current = { sessionMs: telemetryMs, videoSec: currentVirtualTime() };
    lapAnchorsRef.current.clear();
    persistSync(refitTimeline());
  }, [samples, currentIndex, persistSync, currentVirtualTime, refitTimeline]);

  // Fold a fine-alignment correspondence (from the comparison video's manual
  // nudge on a given lap) into the rate fit. Keyed by lap so re-aligning the
  // same lap updates rather than duplicates; the rate refines as more laps are
  // added. No-op until a primary sync exists.
  const addRateAnchor = useCallback((lap: number, sessionMs: number, videoSec: number) => {
    if (!syncAnchorRef.current) return;
    lapAnchorsRef.current.set(lap, { sessionMs, videoSec });
    persistSync(refitTimeline());
  }, [persistSync, refitTimeline]);

  /** Drop all per-lap rate calibration, returning to a pure offset (rate 1). */
  const clearRateAnchors = useCallback(() => {
    lapAnchorsRef.current.clear();
    persistSync(refitTimeline());
  }, [persistSync, refitTimeline]);

  const seekVideo = useCallback((timeSec: number) => {
    const video = videoRef.current;
    if (!video || isLocked) return;
    const total = playlistRef.current?.totalDuration ?? video.duration ?? Infinity;
    const clampedTime = Math.max(0, Math.min(total || Infinity, timeSec));
    seekToVirtual(clampedTime, !video.paused);
  }, [isLocked, seekToVirtual]);

  // Update current time when playing unlocked
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlaying || isLocked) return;
    let active = true;
    const update = () => {
      if (!active) return;
      setVideoCurrentTime(currentVirtualTime());
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
    return () => { active = false; };
  }, [isPlaying, isLocked, videoUrl, currentVirtualTime]);

  const refreshStoredMeta = useCallback(async () => {
    if (!sessionFileName) return;
    const has = await hasSessionVideo(sessionFileName);
    setStoredVideoAvailable(has);
    const meta = has ? await getSessionVideoMeta(sessionFileName) : null;
    setStoredVideoMeta(meta);
  }, [sessionFileName]);

  const handleDeleteStoredVideo = useCallback(async () => {
    if (!sessionFileName) return;
    await deleteSessionVideo(sessionFileName);
    setStoredVideoAvailable(false);
    setStoredVideoMeta(null);
    // If current video was loaded from storage (no file handle), clear it
    if (!fileHandle) {
      revokeAllUrls();
      setVideoFileName(null);
      setExportChunks([]);
      playlistRef.current = null;
      chunkHandlesRef.current = [];
      chunkNamesRef.current = [];
    }
  }, [sessionFileName, fileHandle, revokeAllUrls]);

  const updateOverlaySettings = useCallback((newSettings: OverlaySettings) => {
    setOverlaySettings(newSettings);
    // Persist immediately
    if (sessionFileName) {
      const playlist = playlistRef.current;
      const chunks: VideoSyncChunk[] | undefined = chunkNamesRef.current.length > 0
        ? chunkNamesRef.current.map((name, i) => ({
            fileName: name,
            fileHandle: chunkHandlesRef.current[i],
            durationSec: playlist?.chunks[i]?.durationSec ?? 0,
          }))
        : undefined;
      const record: VideoSyncRecord = {
        sessionFileName,
        syncOffsetMs,
        syncRate: syncRateRef.current,
        syncAnchor: syncAnchorRef.current ?? undefined,
        rateAnchors: [...lapAnchorsRef.current.entries()].map(([lap, a]) => ({ lap, ...a })),
        videoFileName: videoFileName || "",
        fileHandle: chunkHandlesRef.current[0] || fileHandle || undefined,
        isLocked,
        overlaySettings: newSettings,
        chunks,
      };
      saveVideoSync(record);
    }
  }, [sessionFileName, syncOffsetMs, videoFileName, fileHandle, isLocked]);

  // Both objects are memoized so their identity only changes when their
  // contents do — they feed the memoized SessionContext value in Index.tsx,
  // and fresh references on every render would churn the whole context at
  // playback rate.
  const state: VideoSyncState = useMemo(() => ({
    videoUrl, preloadUrl, videoFileName, isLocked, isPlaying, syncOffsetMs, syncRate, rateAnchorCount, fps,
    videoDuration, chunkCount, currentChunkIndex, exportChunks, isOutOfRange, coverage, overlaySettings,
    hasStoredVideo: storedVideoAvailable,
    storedVideoMeta,
    pendingRecordings,
  }), [
    videoUrl, preloadUrl, videoFileName, isLocked, isPlaying, syncOffsetMs, syncRate, rateAnchorCount, fps,
    videoDuration, chunkCount, currentChunkIndex, exportChunks, isOutOfRange, coverage, overlaySettings,
    storedVideoAvailable, storedVideoMeta, pendingRecordings,
  ]);

  const actions: VideoSyncActions = useMemo(() => ({
    loadVideo, chooseRecording, cancelRecordingChoice, toggleLock, togglePlay, stepFrame, setSyncPoint,
    addRateAnchor, clearRateAnchors,
    seekVideo, updateOverlaySettings, deleteStoredVideo: handleDeleteStoredVideo, refreshStoredMeta, videoRef, preloadVideoRef,
  }), [
    loadVideo, chooseRecording, cancelRecordingChoice, toggleLock, togglePlay, stepFrame, setSyncPoint,
    addRateAnchor, clearRateAnchors,
    seekVideo, updateOverlaySettings, handleDeleteStoredVideo, refreshStoredMeta,
  ]);

  // videoCurrentTime is published separately from `state` (via VideoTimeContext in
  // Index.tsx): it churns every video frame during playback and would otherwise
  // re-create the whole VideoSyncState object — and through it the session context.
  return { state, actions, handleLoadedMetadata, videoCurrentTime };
}
