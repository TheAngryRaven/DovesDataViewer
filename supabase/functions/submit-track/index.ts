import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, track_name, track_short_name, course_name, course_data } = await req.json();

    // Validate required fields
    if (!type || !track_name || !course_name || !course_data) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['new_track', 'new_course', 'course_modification'].includes(type)) {
      return new Response(JSON.stringify({ error: 'Invalid submission type' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'new_track' && (!track_short_name || track_short_name.trim().length > 8)) {
      return new Response(JSON.stringify({ error: 'Short name required (max 8 chars) for new tracks' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get submitter IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
               req.headers.get('cf-connecting-ip') || 'unknown';

    // Use service role to bypass RLS
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Check if IP is banned
    const { data: banned } = await supabase
      .from('banned_ips')
      .select('id, expires_at')
      .eq('ip_address', ip)
      .maybeSingle();

    if (banned) {
      if (!banned.expires_at || new Date(banned.expires_at) > new Date()) {
        return new Response(JSON.stringify({ error: 'Your IP has been blocked from submissions.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Ban expired, remove it
      await supabase.from('banned_ips').delete().eq('id', banned.id);
    }

    // Insert submission
    const { error } = await supabase.from('submissions').insert({
      type,
      track_name: track_name.trim(),
      track_short_name: track_short_name?.trim() || null,
      course_name: course_name.trim(),
      course_data,
      status: 'pending',
      submitted_by_ip: ip,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
