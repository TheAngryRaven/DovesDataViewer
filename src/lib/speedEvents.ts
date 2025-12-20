import { GpsSample } from '@/types/racing';

export interface SpeedEvent {
  type: 'peak' | 'valley';
  speed: number; // rounded integer for display
  lat: number;
  lon: number;
  index: number;
  time: number; // ms
}

interface SpeedEventOptions {
  smoothingWindow?: number; // Number of samples for moving average (default: 5)
  minSwing?: number; // Minimum speed difference in mph from previous opposite extremum (default: 3)
  minSeparationMs?: number; // Minimum time between markers in ms (default: 1000)
  debounceCount?: number; // Number of samples the sign must remain changed (default: 2)
}

const DEFAULT_OPTIONS: Required<SpeedEventOptions> = {
  smoothingWindow: 5,
  minSwing: 3,
  minSeparationMs: 1000,
  debounceCount: 2,
};

/**
 * Apply a simple moving average to smooth the speed series
 */
function smoothSpeeds(samples: GpsSample[], windowSize: number): number[] {
  const speeds = samples.map(s => s.speedMph);
  const smoothed: number[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < speeds.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(speeds.length - 1, i + halfWindow); j++) {
      sum += speeds[j];
      count++;
    }
    smoothed.push(sum / count);
  }

  return smoothed;
}

/**
 * Find local speed extrema (peaks and valleys) with hysteresis and noise filtering
 */
export function findSpeedEvents(samples: GpsSample[], options: SpeedEventOptions = {}): SpeedEvent[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (samples.length < opts.smoothingWindow + opts.debounceCount) {
    return [];
  }

  const smoothed = smoothSpeeds(samples, opts.smoothingWindow);
  const events: SpeedEvent[] = [];
  
  // Track state for hysteresis
  let lastExtremumType: 'peak' | 'valley' | null = null;
  let lastExtremumSpeed = 0;
  let lastExtremumTime = -Infinity;
  
  // Track candidate extremum
  let candidateIndex = -1;
  let candidateSpeed = 0;
  let signChangeCount = 0;
  let lastDerivSign: 'pos' | 'neg' | 'zero' = 'zero';

  for (let i = 1; i < smoothed.length; i++) {
    const dv = smoothed[i] - smoothed[i - 1];
    const currentSign: 'pos' | 'neg' | 'zero' = dv > 0.01 ? 'pos' : dv < -0.01 ? 'neg' : 'zero';
    
    // Detect sign change
    if (currentSign !== 'zero' && lastDerivSign !== 'zero' && currentSign !== lastDerivSign) {
      // Sign changed - start tracking a candidate
      const candidateType: 'peak' | 'valley' = lastDerivSign === 'pos' ? 'peak' : 'valley';
      
      // The extremum occurred at index i-1 (before the sign change)
      candidateIndex = i - 1;
      candidateSpeed = smoothed[candidateIndex];
      signChangeCount = 1;
      
      // Continue checking if sign remains changed for debounce period
      let confirmed = true;
      for (let j = i; j < Math.min(i + opts.debounceCount, smoothed.length); j++) {
        const checkDv = smoothed[j] - smoothed[j - 1];
        const checkSign = checkDv > 0.01 ? 'pos' : checkDv < -0.01 ? 'neg' : 'zero';
        
        if (checkSign === 'zero') continue;
        if (checkSign === lastDerivSign) {
          confirmed = false;
          break;
        }
        signChangeCount++;
      }
      
      if (confirmed && signChangeCount >= opts.debounceCount) {
        const sample = samples[candidateIndex];
        const currentTime = sample.t;
        
        // Check minimum separation
        if (currentTime - lastExtremumTime < opts.minSeparationMs) {
          // Too close to last marker - skip
        } else {
          // Check minimum swing (prominence)
          let passesSwing = true;
          if (lastExtremumType !== null) {
            const swing = Math.abs(candidateSpeed - lastExtremumSpeed);
            if (swing < opts.minSwing) {
              passesSwing = false;
            }
          }
          
          // Also check that we're alternating or this is the first
          const isAlternating = lastExtremumType === null || lastExtremumType !== candidateType;
          
          if (passesSwing && isAlternating) {
            events.push({
              type: candidateType,
              speed: Math.round(candidateSpeed),
              lat: sample.lat,
              lon: sample.lon,
              index: candidateIndex,
              time: currentTime,
            });
            
            lastExtremumType = candidateType;
            lastExtremumSpeed = candidateSpeed;
            lastExtremumTime = currentTime;
          } else if (passesSwing && !isAlternating) {
            // Same type as last - replace if this one is more extreme
            if (events.length > 0) {
              const lastEvent = events[events.length - 1];
              const shouldReplace = candidateType === 'peak' 
                ? candidateSpeed > lastEvent.speed 
                : candidateSpeed < lastEvent.speed;
              
              if (shouldReplace) {
                events[events.length - 1] = {
                  type: candidateType,
                  speed: Math.round(candidateSpeed),
                  lat: sample.lat,
                  lon: sample.lon,
                  index: candidateIndex,
                  time: currentTime,
                };
                lastExtremumSpeed = candidateSpeed;
                lastExtremumTime = currentTime;
              }
            }
          }
        }
      }
    }
    
    if (currentSign !== 'zero') {
      lastDerivSign = currentSign;
    }
  }

  return events;
}
