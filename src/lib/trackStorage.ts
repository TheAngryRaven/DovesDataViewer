import { Track, Course, LegacyTrack } from '@/types/racing';

const STORAGE_KEY = 'racing-datalog-tracks-v2';
const LEGACY_STORAGE_KEY = 'racing-datalog-tracks';

interface DefaultTracksJson {
  [trackName: string]: {
    courses: Array<{
      name: string;
      start_a_lat: number;
      start_a_lng: number;
      start_b_lat: number;
      start_b_lng: number;
    }>;
  };
}

interface StoredData {
  tracks: Track[];
}

// Cached default tracks (loaded once)
let defaultTracksCache: Track[] | null = null;

/**
 * Load default tracks from the static JSON file.
 * Returns cached result if already loaded.
 */
export async function loadDefaultTracks(): Promise<Track[]> {
  if (defaultTracksCache !== null) {
    return defaultTracksCache;
  }

  try {
    const response = await fetch('/tracks.json');
    if (!response.ok) {
      console.error('Failed to load tracks.json:', response.statusText);
      return [];
    }
    const json: DefaultTracksJson = await response.json();
    
    const tracks: Track[] = [];
    for (const [trackName, trackData] of Object.entries(json)) {
      const courses: Course[] = trackData.courses.map(c => ({
        name: c.name,
        startFinishA: { lat: c.start_a_lat, lon: c.start_a_lng },
        startFinishB: { lat: c.start_b_lat, lon: c.start_b_lng },
        isUserDefined: false,
      }));
      tracks.push({
        name: trackName,
        courses,
        isUserDefined: false,
      });
    }
    
    defaultTracksCache = tracks;
    return tracks;
  } catch (e) {
    console.error('Error loading default tracks:', e);
    return [];
  }
}

/**
 * Load user-defined tracks from localStorage
 */
function loadUserTracks(): Track[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data: StoredData = JSON.parse(stored);
      return data.tracks || [];
    }
  } catch (e) {
    console.error('Failed to load user tracks:', e);
  }
  return [];
}

/**
 * Migrate legacy tracks (v1 format) to the new format
 */
function migrateLegacyTracks(): Track[] {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored) {
      const legacy: LegacyTrack[] = JSON.parse(stored);
      const migrated: Track[] = [];
      
      for (const lt of legacy) {
        // Skip the default Orlando Kart Center (will be loaded from JSON)
        if (lt.id === 'orlando-kart-center') continue;
        
        migrated.push({
          name: lt.name,
          courses: [{
            name: 'Main',
            startFinishA: lt.startFinishA,
            startFinishB: lt.startFinishB,
            isUserDefined: true,
          }],
          isUserDefined: true,
        });
      }
      
      // Clear legacy storage after migration
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      
      return migrated;
    }
  } catch (e) {
    console.error('Failed to migrate legacy tracks:', e);
  }
  return [];
}

/**
 * Save user-defined tracks to localStorage
 */
function saveUserTracks(tracks: Track[]): void {
  try {
    // Only save user-defined tracks and user-defined courses
    const userTracks: Track[] = tracks
      .filter(t => t.isUserDefined || t.courses.some(c => c.isUserDefined))
      .map(t => ({
        ...t,
        courses: t.courses.filter(c => c.isUserDefined),
      }))
      .filter(t => t.courses.length > 0 || t.isUserDefined);
    
    const data: StoredData = { tracks: userTracks };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save tracks:', e);
  }
}

/**
 * Merge default tracks with user tracks.
 * User-defined courses override defaults with the same name.
 */
function mergeTracks(defaults: Track[], userTracks: Track[]): Track[] {
  const merged: Map<string, Track> = new Map();
  
  // Add defaults first
  for (const track of defaults) {
    merged.set(track.name, { ...track, courses: [...track.courses] });
  }
  
  // Merge user tracks
  for (const userTrack of userTracks) {
    const existing = merged.get(userTrack.name);
    if (existing) {
      // Merge courses: user courses override defaults by name
      const courseMap = new Map<string, Course>();
      for (const course of existing.courses) {
        courseMap.set(course.name, course);
      }
      for (const course of userTrack.courses) {
        courseMap.set(course.name, { ...course, isUserDefined: true });
      }
      existing.courses = Array.from(courseMap.values());
    } else {
      // New track
      merged.set(userTrack.name, { 
        ...userTrack, 
        courses: userTrack.courses.map(c => ({ ...c, isUserDefined: true })),
        isUserDefined: true,
      });
    }
  }
  
  return Array.from(merged.values());
}

/**
 * Load all tracks (defaults + user-defined, merged).
 * Must be called with await.
 */
export async function loadTracks(): Promise<Track[]> {
  const defaults = await loadDefaultTracks();
  const migrated = migrateLegacyTracks();
  const userTracks = loadUserTracks();
  
  // Combine migrated + user tracks
  const allUserTracks = [...migrated, ...userTracks];
  
  // Merge and save if there were migrated tracks
  const merged = mergeTracks(defaults, allUserTracks);
  
  if (migrated.length > 0) {
    saveUserTracks(merged);
  }
  
  return merged;
}

/**
 * Add a new track with an optional initial course.
 */
export async function addTrack(trackName: string, course?: Course): Promise<Track[]> {
  const tracks = await loadTracks();
  
  const existing = tracks.find(t => t.name === trackName);
  if (existing) {
    // Track exists, add course if provided
    if (course) {
      const existingCourse = existing.courses.find(c => c.name === course.name);
      if (!existingCourse) {
        existing.courses.push({ ...course, isUserDefined: true });
      }
    }
  } else {
    // Create new track
    tracks.push({
      name: trackName,
      courses: course ? [{ ...course, isUserDefined: true }] : [],
      isUserDefined: true,
    });
  }
  
  saveUserTracks(tracks);
  return tracks;
}

/**
 * Add a course to an existing track.
 */
export async function addCourse(trackName: string, course: Course): Promise<Track[]> {
  const tracks = await loadTracks();
  
  let track = tracks.find(t => t.name === trackName);
  if (!track) {
    // Create track if it doesn't exist
    track = {
      name: trackName,
      courses: [],
      isUserDefined: true,
    };
    tracks.push(track);
  }
  
  const existingCourse = track.courses.find(c => c.name === course.name);
  if (existingCourse) {
    // Update existing course
    Object.assign(existingCourse, course, { isUserDefined: true });
  } else {
    track.courses.push({ ...course, isUserDefined: true });
  }
  
  saveUserTracks(tracks);
  return tracks;
}

/**
 * Update a track's name.
 */
export async function updateTrackName(oldName: string, newName: string): Promise<Track[]> {
  const tracks = await loadTracks();
  
  const track = tracks.find(t => t.name === oldName);
  if (track) {
    track.name = newName;
    track.isUserDefined = true;
    saveUserTracks(tracks);
  }
  
  return tracks;
}

/**
 * Update a course.
 */
export async function updateCourse(
  trackName: string, 
  courseName: string, 
  updates: Partial<Course>
): Promise<Track[]> {
  const tracks = await loadTracks();
  
  const track = tracks.find(t => t.name === trackName);
  if (track) {
    const course = track.courses.find(c => c.name === courseName);
    if (course) {
      Object.assign(course, updates, { isUserDefined: true });
      saveUserTracks(tracks);
    }
  }
  
  return tracks;
}

/**
 * Delete a course from a track.
 */
export async function deleteCourse(trackName: string, courseName: string): Promise<Track[]> {
  const tracks = await loadTracks();
  
  const track = tracks.find(t => t.name === trackName);
  if (track) {
    track.courses = track.courses.filter(c => c.name !== courseName);
    saveUserTracks(tracks);
  }
  
  return tracks;
}

/**
 * Delete a track (and all its courses).
 */
export async function deleteTrack(trackName: string): Promise<Track[]> {
  let tracks = await loadTracks();
  
  const track = tracks.find(t => t.name === trackName);
  if (track) {
    if (!track.isUserDefined) {
      // Can't delete a default track, just remove user-defined courses
      track.courses = track.courses.filter(c => !c.isUserDefined);
    } else {
      tracks = tracks.filter(t => t.name !== trackName);
    }
    saveUserTracks(tracks);
  }
  
  return tracks;
}

/**
 * Get a specific track by name
 */
export async function getTrack(trackName: string): Promise<Track | undefined> {
  const tracks = await loadTracks();
  return tracks.find(t => t.name === trackName);
}

/**
 * Get a specific course from a track
 */
export async function getCourse(trackName: string, courseName: string): Promise<Course | undefined> {
  const track = await getTrack(trackName);
  return track?.courses.find(c => c.name === courseName);
}
