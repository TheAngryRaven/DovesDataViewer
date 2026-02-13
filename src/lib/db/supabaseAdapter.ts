import { supabase } from '@/integrations/supabase/client';
import type { ITrackDatabase, DbTrack, DbCourse, DbSubmission, DbBannedIp } from './types';

export class SupabaseTrackDatabase implements ITrackDatabase {
  // Tracks
  async getTracks(): Promise<DbTrack[]> {
    const { data, error } = await supabase.from('tracks').select('*').order('name');
    if (error) throw error;
    return (data ?? []) as DbTrack[];
  }

  async getTrack(id: string): Promise<DbTrack | null> {
    const { data, error } = await supabase.from('tracks').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as DbTrack | null;
  }

  async createTrack(input: { name: string; short_name: string; enabled?: boolean }): Promise<DbTrack> {
    const { data, error } = await supabase.from('tracks').insert({
      name: input.name.trim(),
      short_name: input.short_name.trim(),
      enabled: input.enabled ?? true,
    }).select().single();
    if (error) throw error;
    return data as DbTrack;
  }

  async updateTrack(id: string, updates: Partial<Pick<DbTrack, 'name' | 'short_name' | 'enabled'>>): Promise<DbTrack> {
    const clean: Record<string, unknown> = {};
    if (updates.name !== undefined) clean.name = updates.name.trim();
    if (updates.short_name !== undefined) clean.short_name = updates.short_name.trim();
    if (updates.enabled !== undefined) clean.enabled = updates.enabled;
    const { data, error } = await supabase.from('tracks').update(clean).eq('id', id).select().single();
    if (error) throw error;
    return data as DbTrack;
  }

  async deleteTrack(id: string): Promise<void> {
    const { error } = await supabase.from('tracks').delete().eq('id', id);
    if (error) throw error;
  }

  // Courses
  async getCourses(trackId: string): Promise<DbCourse[]> {
    const { data, error } = await supabase.from('courses').select('*').eq('track_id', trackId).order('name');
    if (error) throw error;
    return (data ?? []) as DbCourse[];
  }

  async getAllCourses(): Promise<DbCourse[]> {
    const { data, error } = await supabase.from('courses').select('*').order('name');
    if (error) throw error;
    return (data ?? []) as DbCourse[];
  }

  async createCourse(input: Omit<DbCourse, 'id' | 'created_at' | 'updated_at'>): Promise<DbCourse> {
    const { data, error } = await supabase.from('courses').insert({
      track_id: input.track_id,
      name: input.name.trim(),
      enabled: input.enabled,
      start_a_lat: input.start_a_lat,
      start_a_lng: input.start_a_lng,
      start_b_lat: input.start_b_lat,
      start_b_lng: input.start_b_lng,
      sector_2_a_lat: input.sector_2_a_lat,
      sector_2_a_lng: input.sector_2_a_lng,
      sector_2_b_lat: input.sector_2_b_lat,
      sector_2_b_lng: input.sector_2_b_lng,
      sector_3_a_lat: input.sector_3_a_lat,
      sector_3_a_lng: input.sector_3_a_lng,
      sector_3_b_lat: input.sector_3_b_lat,
      sector_3_b_lng: input.sector_3_b_lng,
      superseded_by: input.superseded_by,
    }).select().single();
    if (error) throw error;
    return data as DbCourse;
  }

  async updateCourse(id: string, updates: Partial<Omit<DbCourse, 'id' | 'created_at' | 'updated_at'>>): Promise<DbCourse> {
    const clean: Record<string, unknown> = { ...updates };
    if (typeof clean.name === 'string') clean.name = (clean.name as string).trim();
    const { data, error } = await supabase.from('courses').update(clean).eq('id', id).select().single();
    if (error) throw error;
    return data as DbCourse;
  }

  async toggleCourse(id: string, enabled: boolean): Promise<void> {
    const { error } = await supabase.from('courses').update({ enabled }).eq('id', id);
    if (error) throw error;
  }

  // Submissions
  async getSubmissions(status?: string): Promise<DbSubmission[]> {
    let query = supabase.from('submissions').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as unknown as DbSubmission[];
  }

  async updateSubmission(id: string, status: string, reviewNotes?: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('submissions').update({
      status,
      review_notes: reviewNotes ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
    }).eq('id', id);
    if (error) throw error;
  }

  // Banned IPs
  async getBannedIps(): Promise<DbBannedIp[]> {
    const { data, error } = await supabase.from('banned_ips').select('*').order('banned_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbBannedIp[];
  }

  async banIp(ip: string, reason?: string, expiresAt?: string): Promise<void> {
    const { error } = await supabase.from('banned_ips').insert({
      ip_address: ip.trim(),
      reason: reason ?? null,
      expires_at: expiresAt ?? null,
    });
    if (error) throw error;
  }

  async unbanIp(id: string): Promise<void> {
    const { error } = await supabase.from('banned_ips').delete().eq('id', id);
    if (error) throw error;
  }

  // Build tracks.json from DB
  async buildTracksJson(): Promise<string> {
    const tracks = await this.getTracks();
    const courses = await this.getAllCourses();

    const result: Record<string, unknown> = {};
    for (const track of tracks) {
      if (!track.enabled) continue;
      const trackCourses = courses.filter(c => c.track_id === track.id && c.enabled);
      const courseList = trackCourses.map(c => {
        const obj: Record<string, unknown> = {
          name: c.name,
          start_a_lat: c.start_a_lat,
          start_a_lng: c.start_a_lng,
          start_b_lat: c.start_b_lat,
          start_b_lng: c.start_b_lng,
        };
        if (c.sector_2_a_lat != null) {
          obj.sector_2_a_lat = c.sector_2_a_lat;
          obj.sector_2_a_lng = c.sector_2_a_lng;
          obj.sector_2_b_lat = c.sector_2_b_lat;
          obj.sector_2_b_lng = c.sector_2_b_lng;
        }
        if (c.sector_3_a_lat != null) {
          obj.sector_3_a_lat = c.sector_3_a_lat;
          obj.sector_3_a_lng = c.sector_3_a_lng;
          obj.sector_3_b_lat = c.sector_3_b_lat;
          obj.sector_3_b_lng = c.sector_3_b_lng;
        }
        return obj;
      });
      result[track.name] = { short_name: track.short_name, courses: courseList };
    }
    return JSON.stringify(result, null, 2);
  }

  // Import tracks.json into DB (rebuilds DB from JSON)
  async importFromTracksJson(json: string): Promise<void> {
    const parsed = JSON.parse(json) as Record<string, { short_name?: string; courses: Array<Record<string, unknown>> }>;

    for (const [trackName, trackData] of Object.entries(parsed)) {
      const shortName = trackData.short_name || trackName.split(/\s+/).map(w => w[0]).join('').slice(0, 8).toUpperCase();
      
      // Upsert track
      let track: DbTrack;
      const { data: existing } = await supabase.from('tracks').select('*').eq('name', trackName.trim()).maybeSingle();
      if (existing) {
        track = existing as DbTrack;
        await supabase.from('tracks').update({ short_name: shortName, enabled: true }).eq('id', track.id);
      } else {
        const { data, error } = await supabase.from('tracks').insert({
          name: trackName.trim(),
          short_name: shortName,
          enabled: true,
        }).select().single();
        if (error) throw error;
        track = data as DbTrack;
      }

      // Add courses
      for (const c of trackData.courses) {
        const courseName = (c.name as string || 'Main').trim();
        const { data: existingCourse } = await supabase.from('courses').select('id').eq('track_id', track.id).eq('name', courseName).maybeSingle();
        
        const courseData = {
          track_id: track.id,
          name: courseName,
          enabled: true,
          start_a_lat: c.start_a_lat as number,
          start_a_lng: c.start_a_lng as number,
          start_b_lat: c.start_b_lat as number,
          start_b_lng: c.start_b_lng as number,
          sector_2_a_lat: (c.sector_2_a_lat as number) ?? null,
          sector_2_a_lng: (c.sector_2_a_lng as number) ?? null,
          sector_2_b_lat: (c.sector_2_b_lat as number) ?? null,
          sector_2_b_lng: (c.sector_2_b_lng as number) ?? null,
          sector_3_a_lat: (c.sector_3_a_lat as number) ?? null,
          sector_3_a_lng: (c.sector_3_a_lng as number) ?? null,
          sector_3_b_lat: (c.sector_3_b_lat as number) ?? null,
          sector_3_b_lng: (c.sector_3_b_lng as number) ?? null,
        };

        if (existingCourse) {
          await supabase.from('courses').update(courseData).eq('id', existingCourse.id);
        } else {
          await supabase.from('courses').insert({ ...courseData, superseded_by: null });
        }
      }
    }
  }
}
