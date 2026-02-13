import type { ITrackDatabase } from './types';
import { SupabaseTrackDatabase } from './supabaseAdapter';

let instance: ITrackDatabase | null = null;

/**
 * Get the database adapter. Currently returns Supabase implementation.
 * Swap this factory to use PostgreSQL/MySQL adapters instead.
 */
export function getDatabase(): ITrackDatabase {
  if (!instance) {
    instance = new SupabaseTrackDatabase();
  }
  return instance;
}

export type { ITrackDatabase, DbTrack, DbCourse, DbSubmission, DbBannedIp } from './types';
