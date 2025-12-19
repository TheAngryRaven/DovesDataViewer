import { Track } from '@/types/racing';

const STORAGE_KEY = 'racing-datalog-tracks';

export function loadTracks(): Track[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load tracks:', e);
  }
  return [];
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
