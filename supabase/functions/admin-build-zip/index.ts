import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** Haversine distance in meters between two lat/lon points */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polylineLengthMeters(points: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claims, error: claimsErr } = await supabaseAuth.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: roleRow } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', claims.claims.sub)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load data
    const { data: tracks } = await supabase.from('tracks').select('*').eq('enabled', true).order('name');
    const { data: courses } = await supabase.from('courses').select('*').eq('enabled', true).order('name');
    const { data: layouts } = await supabase.from('course_layouts').select('*');

    if (!tracks || !courses) throw new Error('Failed to load data');

    const layoutMap = new Map<string, Array<{ lat: number; lon: number }>>();
    if (layouts) {
      for (const l of layouts) {
        layoutMap.set(l.course_id, l.layout_data as Array<{ lat: number; lon: number }>);
      }
    }

    const files: Record<string, string> = {};

    for (const track of tracks) {
      const trackCourses = courses.filter((c: { track_id: string }) => c.track_id === track.id);

      // Determine default course
      const defaultCourse = trackCourses.find((c: { id: string }) => c.id === track.default_course_id);
      const defaultCourseName = defaultCourse?.name ?? trackCourses[0]?.name ?? '';

      const courseList = trackCourses.map((c: Record<string, unknown>) => {
        const layoutPoints = layoutMap.get(c.id as string);
        const lengthFt = (c.length_ft_override as number | null) != null
          ? (c.length_ft_override as number)
          : (layoutPoints && layoutPoints.length >= 2
            ? Math.round(polylineLengthMeters(layoutPoints) * 3.28084)
            : 0);

        const obj: Record<string, unknown> = {
          name: c.name,
          lengthFt,
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

      const trackJson = {
        longName: track.name,
        shortName: track.short_name,
        defaultCourse: defaultCourseName,
        courses: courseList,
      };

      files[`TRACKS/${track.short_name}.json`] = JSON.stringify(trackJson, null, 2);
    }

    return new Response(JSON.stringify(files), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('admin-build-zip error:', e);
    return new Response(JSON.stringify({ error: 'An error occurred. Please try again later.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
