import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    // Check admin role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: isAdmin } = await supabase.rpc('has_role', {
      _user_id: claims.claims.sub,
      _role: 'admin',
    });

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build ZIP - create individual track JSON files
    const { data: tracks } = await supabase.from('tracks').select('*').eq('enabled', true).order('name');
    const { data: courses } = await supabase.from('courses').select('*').eq('enabled', true).order('name');

    if (!tracks || !courses) throw new Error('Failed to load data');

    const files: Record<string, string> = {};
    
    for (const track of tracks) {
      const trackCourses = courses.filter((c: { track_id: string }) => c.track_id === track.id);
      const courseList = trackCourses.map((c: Record<string, unknown>) => {
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

      files[`TRACKS/${track.short_name}.json`] = JSON.stringify(
        { [track.name]: { short_name: track.short_name, courses: courseList } },
        null,
        2
      );
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
