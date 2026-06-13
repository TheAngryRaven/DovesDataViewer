-- Unlimited sectors: store the full ordered sector list on courses + submissions.
--
-- The app now supports an ordered list of up to 25 timing lines per course
-- (start/finish + sub-sectors), of which exactly three are "major". Only the
-- three majors are exported to the BLE logger, so the existing sector_2/sector_3
-- columns are kept as a mirror of the two majors for back-compat + device export.
-- The canonical list rides a new jsonb column.
--
-- Shape: jsonb array of { a_lat, a_lng, b_lat, b_lng, major } (start/finish excluded).

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS sectors_data jsonb;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS sectors_data jsonb;

COMMENT ON COLUMN public.courses.sectors_data IS
  'Ordered sector lines after start/finish: [{a_lat,a_lng,b_lat,b_lng,major}]. The sector_2/3 columns mirror the two majors for device export.';
COMMENT ON COLUMN public.submissions.sectors_data IS
  'Submitted ordered sector lines (mirrors courses.sectors_data shape).';
