import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) {
    console.warn('TURNSTILE_SECRET_KEY not set, skipping verification');
    return true;
  }

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  });

  const result = await resp.json();
  return result.success === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, track_name, track_short_name, course_name, course_data, turnstile_token } = await req.json();

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

    // Validate track/course name lengths
    if (track_name.trim().length > 100 || course_name.trim().length > 100) {
      return new Response(JSON.stringify({ error: 'Names must be under 100 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate coordinate data
    const requiredCoords = ['start_a_lat', 'start_a_lng', 'start_b_lat', 'start_b_lng'];
    for (const key of requiredCoords) {
      if (typeof course_data[key] !== 'number' || isNaN(course_data[key])) {
        return new Response(JSON.stringify({ error: `Invalid coordinate: ${key}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Validate optional sector coordinates if present
    const optionalCoords = [
      'sector_2_a_lat', 'sector_2_a_lng', 'sector_2_b_lat', 'sector_2_b_lng',
      'sector_3_a_lat', 'sector_3_a_lng', 'sector_3_b_lat', 'sector_3_b_lng',
    ];
    for (const key of optionalCoords) {
      if (course_data[key] !== undefined && (typeof course_data[key] !== 'number' || isNaN(course_data[key]))) {
        return new Response(JSON.stringify({ error: `Invalid coordinate: ${key}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get submitter IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
               req.headers.get('cf-connecting-ip') || 'unknown';

    // Verify Turnstile token
    if (Deno.env.get('TURNSTILE_SECRET_KEY')) {
      if (!turnstile_token || typeof turnstile_token !== 'string') {
        return new Response(JSON.stringify({ error: 'Verification required. Please complete the CAPTCHA.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const valid = await verifyTurnstile(turnstile_token, ip);
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Verification failed. Please try again.' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

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

    // Rate limiting: max 5 submissions per hour per IP
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('submitted_by_ip', ip)
      .gte('created_at', oneHourAgo);

    if (count !== null && count >= 5) {
      return new Response(JSON.stringify({ error: 'Too many submissions. Please try again later.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
    console.error('submit-track error:', e);
    return new Response(JSON.stringify({ error: 'An error occurred. Please try again later.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
