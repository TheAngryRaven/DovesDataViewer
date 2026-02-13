// Modular database layer types — swap implementations for different backends

export interface DbTrack {
  id: string;
  name: string;
  short_name: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbCourse {
  id: string;
  track_id: string;
  name: string;
  enabled: boolean;
  start_a_lat: number;
  start_a_lng: number;
  start_b_lat: number;
  start_b_lng: number;
  sector_2_a_lat: number | null;
  sector_2_a_lng: number | null;
  sector_2_b_lat: number | null;
  sector_2_b_lng: number | null;
  sector_3_a_lat: number | null;
  sector_3_a_lng: number | null;
  sector_3_b_lat: number | null;
  sector_3_b_lng: number | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSubmission {
  id: string;
  type: 'new_track' | 'new_course' | 'course_modification';
  track_name: string;
  track_short_name: string | null;
  course_name: string;
  course_data: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  submitted_by_ip: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
}

export interface DbBannedIp {
  id: string;
  ip_address: string;
  reason: string | null;
  banned_at: string;
  expires_at: string | null;
}

export interface ITrackDatabase {
  // Tracks
  getTracks(): Promise<DbTrack[]>;
  getTrack(id: string): Promise<DbTrack | null>;
  createTrack(data: { name: string; short_name: string; enabled?: boolean }): Promise<DbTrack>;
  updateTrack(id: string, data: Partial<Pick<DbTrack, 'name' | 'short_name' | 'enabled'>>): Promise<DbTrack>;
  deleteTrack(id: string): Promise<void>;

  // Courses
  getCourses(trackId: string): Promise<DbCourse[]>;
  getAllCourses(): Promise<DbCourse[]>;
  createCourse(data: Omit<DbCourse, 'id' | 'created_at' | 'updated_at'>): Promise<DbCourse>;
  updateCourse(id: string, data: Partial<Omit<DbCourse, 'id' | 'created_at' | 'updated_at'>>): Promise<DbCourse>;
  toggleCourse(id: string, enabled: boolean): Promise<void>;

  // Submissions
  getSubmissions(status?: string): Promise<DbSubmission[]>;
  updateSubmission(id: string, status: string, reviewNotes?: string): Promise<void>;

  // Banned IPs
  getBannedIps(): Promise<DbBannedIp[]>;
  banIp(ip: string, reason?: string, expiresAt?: string): Promise<void>;
  unbanIp(id: string): Promise<void>;

  // Build
  buildTracksJson(): Promise<string>;
  importFromTracksJson(json: string): Promise<void>;
}
