

# Add Track Database, Admin Panel, and Submission System

## Overview
Add a Supabase-backed admin system for managing track submissions while keeping the app's core behavior unchanged: the app always reads `public/tracks.json`, never the database. The database exists solely for the admin workflow: users submit tracks/courses, admin reviews and approves, admin rebuilds `tracks.json` from approved records.

All database code lives behind a modular abstraction layer so the Supabase implementation can be swapped for PostgreSQL/MySQL with minimal effort. The entire admin system can be hidden with an environment variable for local installs.

## Key Addition: Track Short Names

Every track has both a full `name` (e.g., "Orlando Kart Center") and a `short_name` (max 8 characters, e.g., "OKC"). The short name is used for:
- Generating filenames in the tracks zip export (`OKC.json`)
- Compact display in the UI header (replacing the current auto-abbreviation logic)
- The existing `abbreviateTrackName()` function becomes the fallback for tracks that don't have a short name set

The `tracks.json` format gains a `short_name` field per track. The `Track` type gains a `shortName` property. The database `tracks` table has a `short_name VARCHAR(8) UNIQUE NOT NULL` column.

Updated `tracks.json` format:
```json
{
  "Orlando Kart Center": {
    "short_name": "OKC",
    "courses": [ ... ]
  }
}
```

---

## Architecture

The app continues to load tracks from `public/tracks.json` at runtime -- zero database calls on normal page loads. The database is only touched by:
1. Public users submitting new tracks/courses/modifications (via edge function with Turnstile captcha)
2. Admins managing submissions, tracks, and courses via the admin panel
3. Admin rebuilding `tracks.json` or `tracks.zip` from the database

A feature flag (`VITE_ENABLE_ADMIN`) controls whether login/admin UI elements appear. When disabled, the app behaves exactly as it does today.

---

## Database Schema (Supabase / Lovable Cloud)

### Tables

**tracks**
- `id` UUID PK default gen_random_uuid()
- `name` TEXT UNIQUE NOT NULL
- `short_name` VARCHAR(8) UNIQUE NOT NULL
- `enabled` BOOLEAN DEFAULT true
- `created_at` TIMESTAMPTZ DEFAULT now()
- `updated_at` TIMESTAMPTZ DEFAULT now()

**courses**
- `id` UUID PK default gen_random_uuid()
- `track_id` UUID FK -> tracks.id ON DELETE CASCADE
- `name` TEXT NOT NULL
- `enabled` BOOLEAN DEFAULT true
- `start_a_lat` FLOAT8 NOT NULL, `start_a_lng` FLOAT8 NOT NULL
- `start_b_lat` FLOAT8 NOT NULL, `start_b_lng` FLOAT8 NOT NULL
- `sector_2_a_lat` FLOAT8, `sector_2_a_lng` FLOAT8, `sector_2_b_lat` FLOAT8, `sector_2_b_lng` FLOAT8
- `sector_3_a_lat` FLOAT8, `sector_3_a_lng` FLOAT8, `sector_3_b_lat` FLOAT8, `sector_3_b_lng` FLOAT8
- `superseded_by` UUID FK -> courses.id (for modification history)
- `created_at` TIMESTAMPTZ DEFAULT now()
- `updated_at` TIMESTAMPTZ DEFAULT now()
- UNIQUE(track_id, name) WHERE enabled = true

**submissions**
- `id` UUID PK default gen_random_uuid()
- `type` TEXT NOT NULL CHECK (type IN ('new_track', 'new_course', 'course_modification'))
- `track_name` TEXT NOT NULL
- `track_short_name` VARCHAR(8) (required for new_track submissions)
- `course_name` TEXT NOT NULL
- `course_data` JSONB NOT NULL (full course coordinates)
- `status` TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied'))
- `submitted_by_ip` TEXT
- `created_at` TIMESTAMPTZ DEFAULT now()
- `reviewed_at` TIMESTAMPTZ
- `reviewed_by` UUID FK -> auth.users
- `review_notes` TEXT

**banned_ips**
- `id` UUID PK default gen_random_uuid()
- `ip_address` TEXT UNIQUE NOT NULL
- `reason` TEXT
- `banned_at` TIMESTAMPTZ DEFAULT now()
- `expires_at` TIMESTAMPTZ (null = permanent)

**login_attempts**
- `ip_address` TEXT PK
- `attempts` INT DEFAULT 0
- `locked_until` TIMESTAMPTZ

**user_roles**
- `id` UUID PK default gen_random_uuid()
- `user_id` UUID FK -> auth.users ON DELETE CASCADE
- `role` TEXT NOT NULL CHECK (role IN ('admin', 'user'))
- UNIQUE(user_id, role)

### RLS Policies
- `tracks` and `courses`: SELECT for authenticated admins only (public never reads DB)
- `submissions`: INSERT for anon (via edge function only), SELECT/UPDATE for admins
- `banned_ips`: Full CRUD for admins
- `user_roles`: SELECT via `has_role()` security definer function

### Security Definer Function
```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
END;
$$;
```

---

## Edge Functions

### 1. `submit-track`
- Validates Cloudflare Turnstile token server-side
- Checks if IP is banned
- Trims track name, short name, and course name
- Validates short_name is <= 8 chars and alphanumeric
- Inserts into `submissions` table with status='pending'

### 2. `admin-build-json`
- Requires admin auth
- Queries all enabled tracks + enabled courses
- Builds the `tracks.json` format (with `short_name` per track)
- Returns JSON for download

### 3. `admin-build-zip`
- Requires admin auth
- Queries all enabled tracks + enabled courses
- Creates `TRACKS/{short_name}.json` per track
- Returns downloadable zip

### 4. `check-login-rate`
- Checks `login_attempts` for IP
- Blocks after 5 failed attempts for 1 hour
- Resets on successful login

---

## Modular Database Layer

```text
src/lib/db/
  types.ts            -- DbTrack, DbCourse, DbSubmission, ITrackDatabase interface
  supabaseAdapter.ts  -- Supabase implementation
  index.ts            -- Factory: getDatabase()
```

The `ITrackDatabase` interface includes track short_name in all CRUD operations:
- `createTrack({ name, short_name, enabled })` 
- `updateTrack(id, { name?, short_name?, enabled? })`
- Track queries always return short_name

---

## Type and Data Format Changes

### `src/types/racing.ts`
- Add `shortName?: string` to the `Track` interface

### `public/tracks.json`
- Add `"short_name"` field to each track entry
- Orlando Kart Center gets `"short_name": "OKC"`

### `src/lib/trackStorage.ts`
- Parse `short_name` from the JSON when loading defaults
- Include `shortName` in the `Track` object
- Merge logic preserves short names

### `src/lib/trackUtils.ts`
- `abbreviateTrackName()` stays as a fallback
- New helper: `getTrackDisplayName(track)` returns `track.shortName || abbreviateTrackName(track.name)`

### Track Editor / Forms
- Add short name field (max 8 chars) when creating tracks
- Validation: alphanumeric, max 8 chars, trimmed

---

## Frontend Changes

### New Files

**Pages:**
- `src/pages/Admin.tsx` -- Admin dashboard with tabbed interface
- `src/pages/Login.tsx` -- Email/password login form

**Components:**
- `src/components/admin/SubmissionsTab.tsx` -- List/approve/deny submissions
- `src/components/admin/TracksTab.tsx` -- CRUD table for tracks (name + short_name + enabled toggle)
- `src/components/admin/CoursesTab.tsx` -- CRUD for courses, integrates VisualEditor
- `src/components/admin/ToolsTab.tsx` -- Build JSON, Build ZIP, Import from JSON, Rebuild DB
- `src/components/admin/BannedIpsTab.tsx` -- View/add/remove banned IPs
- `src/components/SubmitTrackDialog.tsx` -- Public submission form with Turnstile captcha

**Hooks:**
- `src/hooks/useAuth.ts` -- Login, logout, session, isAdmin check

**Lib:**
- `src/lib/db/types.ts`, `src/lib/db/supabaseAdapter.ts`, `src/lib/db/index.ts`
- `src/lib/captcha.ts` -- Turnstile loader

### Modified Files

- `src/App.tsx` -- Add `/login` and `/admin` routes (guarded by VITE_ENABLE_ADMIN)
- `src/pages/Index.tsx` -- Add Login/Admin buttons in header, Submit Track button, Download Tracks button (all on homepage/no-data view only)
- `src/types/racing.ts` -- Add `shortName` to Track
- `public/tracks.json` -- Add `short_name` per track
- `src/lib/trackStorage.ts` -- Parse and merge short names
- `src/lib/trackUtils.ts` -- Add display name helper
- `src/components/TrackEditor.tsx` -- Short name field in track creation
- `src/components/track-editor/AddTrackDialog.tsx` -- Short name input (max 8 chars)
- `README.md` -- Document migrations, env vars, DB setup

---

## Captcha: Cloudflare Turnstile
- Free tier: 1M verifications/month
- Site key in `VITE_TURNSTILE_SITE_KEY` (client-side)
- Secret key in Supabase secrets (edge function)

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITE_ENABLE_ADMIN` | Show login/admin/submit UI (omit to hide) |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile public site key |
| `TURNSTILE_SECRET_KEY` | Supabase secret for server-side validation |

---

## Course Modification Flow
1. Admin approves a "course_modification" submission
2. Existing course gets `enabled = false` (NOT deleted)
3. Old course's `superseded_by` set to new course ID
4. New course created with `enabled = true`

---

## Download Tracks for Datalogger
A button on the homepage (no-data view) that downloads `public/tracks.json` directly -- no database call. Simple anchor/fetch download.

---

## Implementation Order
1. Set up Lovable Cloud (Supabase)
2. Create database migrations (all tables, RLS, functions)
3. Update `Track` type with `shortName`, update `tracks.json` format, update parsers
4. Create modular DB layer
5. Create auth hook and login page
6. Create admin page with all tabs (reusing VisualEditor, CourseForm, existing tab/table patterns)
7. Create public submission dialog with Turnstile
8. Create edge functions
9. Add UI buttons to homepage
10. Add routes to App.tsx
11. Update README

---

## What This Does NOT Change
- App still reads from `public/tracks.json` -- zero DB calls on load
- All existing functionality untouched
- Local installs without `VITE_ENABLE_ADMIN` see no admin UI
- PWA offline behavior unaffected

