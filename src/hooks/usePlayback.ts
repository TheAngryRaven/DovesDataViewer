import { useState, useRef, useCallback, useEffect } from 'react';
import { GpsSample } from '@/types/racing';

interface UsePlaybackOptions {
  samples: GpsSample[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  visibleRange: [number, number];
}

interface UsePlaybackReturn {
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  averageFrameRate: number | null; // Hz
}

/**
 * Hook to manage playback of telemetry data at realistic speed.
 * Animates through samples based on their actual timestamps.
 */
export function usePlayback({
  samples,
  currentIndex,
  onIndexChange,
  visibleRange,
}: UsePlaybackOptions): UsePlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const startPlaybackIndexRef = useRef<number>(0);
  const playbackStartTimeRef = useRef<number>(0);
  const baseDataTimeRef = useRef<number>(0);

  // Calculate average frame rate from sample timestamps
  const averageFrameRate = useCallback((): number | null => {
    if (samples.length < 2) return null;

    // Calculate time differences between consecutive samples
    const timeDiffs: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const diff = samples[i].t - samples[i - 1].t;
      if (diff > 0 && diff < 1000) { // Ignore gaps > 1 second
        timeDiffs.push(diff);
      }
    }

    if (timeDiffs.length === 0) return null;

    // Calculate median to be robust against outliers
    timeDiffs.sort((a, b) => a - b);
    const medianInterval = timeDiffs[Math.floor(timeDiffs.length / 2)];

    // Convert to Hz (frames per second)
    return 1000 / medianInterval;
  }, [samples])();

  // Stop playback when component unmounts or samples change significantly
  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, []);

  // Stop playback when visible range changes
  useEffect(() => {
    if (isPlaying) {
      setIsPlaying(false);
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }
  }, [visibleRange[0], visibleRange[1]]);

  const animate = useCallback((timestamp: number) => {
    if (!isPlaying) return;

    // Initialize on first frame
    if (lastFrameTimeRef.current === 0) {
      lastFrameTimeRef.current = timestamp;
      playbackStartTimeRef.current = timestamp;
      startPlaybackIndexRef.current = currentIndex;
      baseDataTimeRef.current = samples[currentIndex]?.t ?? 0;
      animationRef.current = requestAnimationFrame(animate);
      return;
    }

    // Calculate how much real time has passed since playback started
    const elapsedRealTime = timestamp - playbackStartTimeRef.current;

    // Find the sample that matches this elapsed time
    const targetDataTime = baseDataTimeRef.current + elapsedRealTime;

    // Find the index of the sample closest to this time
    let targetIndex = startPlaybackIndexRef.current;
    const maxIndex = visibleRange[1] - visibleRange[0];

    for (let i = startPlaybackIndexRef.current; i <= maxIndex; i++) {
      if (samples[i].t >= targetDataTime) {
        targetIndex = i;
        break;
      }
      targetIndex = i;
    }

    // Check if we've reached the end
    if (targetIndex >= maxIndex) {
      onIndexChange(maxIndex);
      setIsPlaying(false);
      animationRef.current = null;
      lastFrameTimeRef.current = 0;
      return;
    }

    // Update index if it changed
    if (targetIndex !== currentIndex) {
      onIndexChange(targetIndex);
    }

    lastFrameTimeRef.current = timestamp;
    animationRef.current = requestAnimationFrame(animate);
  }, [isPlaying, currentIndex, samples, onIndexChange, visibleRange]);

  // Start animation loop when playing
  useEffect(() => {
    if (isPlaying && samples.length > 0) {
      lastFrameTimeRef.current = 0; // Reset to trigger initialization
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isPlaying, animate, samples.length]);

  const play = useCallback(() => {
    if (samples.length === 0) return;

    // If at the end, restart from beginning
    const maxIndex = visibleRange[1] - visibleRange[0];
    if (currentIndex >= maxIndex) {
      onIndexChange(0);
    }

    setIsPlaying(true);
  }, [samples.length, currentIndex, visibleRange, onIndexChange]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    lastFrameTimeRef.current = 0;
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  return {
    isPlaying,
    play,
    pause,
    toggle,
    averageFrameRate,
  };
}
