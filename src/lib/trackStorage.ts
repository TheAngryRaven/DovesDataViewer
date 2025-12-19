import { Track } from '@/types/racing';

const STORAGE_KEY = 'racing-datalog-tracks';

const DEFAULT_TRACKS: Track[] = [
  {
    id: 'orlando-kart-center',
    name: 'Orlando Kart Center',
    startFinishA: { lat: 28.41270817056385, lon: -81.37973266418031 },
    startFinishB: { lat: 28.41273038679321, lon: -81.37957048753776 },
    createdAt: 0
  }
];

export function loadTracks(): Track[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const saved = JSON.parse(stored) as Track[];
      // Merge defaults (add any missing default tracks)
      const merged = [...saved];
      for (const def of DEFAULT_TRACKS) {
        if (!merged.find(t => t.id === def.id)) {
          merged.push(def);
        }
      }
      return merged;
    }
  } catch (e) {
    console.error('Failed to load tracks:', e);
  }
  return [...DEFAULT_TRACKS];
}

export function saveTracks(tracks: Track[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
  } catch (e) {
    console.error('Failed to save tracks:', e);
  }
}

export function addTrack(track: Track): Track[] {
  const tracks = loadTracks();
  tracks.push(track);
  saveTracks(tracks);
  return tracks;
}

export function updateTrack(trackId: string, updates: Partial<Track>): Track[] {
  const tracks = loadTracks();
  const index = tracks.findIndex(t => t.id === trackId);
  if (index !== -1) {
    tracks[index] = { ...tracks[index], ...updates };
    saveTracks(tracks);
  }
  return tracks;
}

export function deleteTrack(trackId: string): Track[] {
  const tracks = loadTracks().filter(t => t.id !== trackId);
  saveTracks(tracks);
  return tracks;
}

export function generateTrackId(): string {
  return `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
