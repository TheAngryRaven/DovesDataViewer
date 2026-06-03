import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// A single bulk submit may carry many courses, but cap it so one request can't
// flood the queue. Also cap how many rows one IP can add per rolling hour.
const MAX_BATCH = 200;
const MAX_ROWS_PER_HOUR = 300;

interface SubmissionInput {
  type?: string;
  track_name?: string;
  track_short_name?: string;
  course_name?: string;
  course_data?: Record<string, unknown>;
  layout_data?: unknown;
}

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

/** Validate one submission. Returns an error message, or null when valid. */
function validateSubmission(s: SubmissionInput): string | null {
  const { type, track_name, track_short_name, course_name, course_data } = s;

  if (!type || !track_name || !course_name || !course_data) {
    return 'Missing required fields';
  }
  if (!['new_track', 'new_course', 'course_modification'].includes(type)) {
    return 'Invalid submission type';
  }
  if (type === 'new_track' && (!track_short_name || track_short_name.trim().length > 8)) {
    return 'Short name required (max 8 chars) for new tracks';
  }
  if (track_name.trim().length > 100 || course_name.trim().length > 100) {
    return 'Names must be under 100 characters';
  }

  const requiredCoords = ['start_a_lat', 'start_a_lng', 'start_b_lat', 'start_b_lng'];
  for (const key of requiredCoords) {
    const v = course_data[key];
    if (typeof v !== 'number' || isNaN(v)) return `Invalid coordinate: ${key}`;
  }

  const optionalCoords = [
    'sector_2_a_lat', 'sector_2_a_lng', 'sector_2_b_lat', 'sector_2_b_lng',
    'sector_3_a_lat', 'sector_3_a_lng', 'sector_3_b_lat', 'sector_3_b_lng',
  ];
  for (const key of optionalCoords) {
    const v = course_data[key];
    if (v !== undefined && (typeof v !== 'number' || isNaN(v))) return `Invalid coordinate: ${key}`;
  }

  return null;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { turnstile_token } = body;

    // Accept either a bulk `submissions` array (new flow) or a single
    // submission at the top level (legacy single-course flow).
    const items: SubmissionInput[] = Array.isArray(body.submissions)
      ? body.submissions
      : [body];

    if (items.length === 0) {
      return jsonError('No submissions provided', 400);
    }
    if (items.length > MAX_BATCH) {
      return jsonError(`Too many courses in one submission (max ${MAX_BATCH})`, 400);
    }

    // Validate every item up front — reject the whole batch on the first bad one.
    for (let i = 0; i < items.length; i++) {
      const err = validateSubmission(items[i]);
      if (err) {
        return jsonError(items.length > 1 ? `Submission ${i + 1}: ${err}` : err, 400);
      }
    }

    // Get submitter IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               req.headers.get('cf-connecting-ip') || 'unknown';

    // Verify Turnstile token (once for the whole batch)
    if (Deno.env.get('TURNSTILE_SECRET_KEY')) {
      if (!turnstile_token || typeof turnstile_token !== 'string') {
        return jsonError('Verification required. Please complete the CAPTCHA.', 400);
      }
      const valid = await verifyTurnstile(turnstile_token, ip);
      if (!valid) {
        return jsonError('Verification failed. Please try again.', 403);
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
        return jsonError('Your IP has been blocked from submissions.', 403);
      }
      // Ban expired, remove it
      await supabase.from('banned_ips').delete().eq('id', banned.id);
    }

    // Rate limiting: cap total rows added per rolling hour per IP.
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('submitted_by_ip', ip)
      .gte('created_at', oneHourAgo);

    if (count !== null && count + items.length > MAX_ROWS_PER_HOUR) {
      return jsonError('Too many submissions. Please try again later.', 429);
    }

    // One batch id ties this upload together for admin review.
    const batchId = crypto.randomUUID();

    const rows = items.map((s) => {
      const hasLayout = Array.isArray(s.layout_data) && s.layout_data.length > 0;
      return {
        type: s.type,
        track_name: s.track_name!.trim(),
        track_short_name: s.track_short_name?.trim() || null,
        course_name: s.course_name!.trim(),
        course_data: s.course_data,
        status: 'pending',
        submitted_by_ip: ip,
        batch_id: batchId,
        has_layout: hasLayout,
        layout_data: hasLayout ? s.layout_data : null,
      };
    });

    const { error } = await supabase.from('submissions').insert(rows);
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, batch_id: batchId, count: rows.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('submit-track error:', e);
    return jsonError('An error occurred. Please try again later.', 500);
  }
});
