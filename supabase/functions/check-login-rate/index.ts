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
    const { ip, success } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (!ip) {
      return new Response(JSON.stringify({ error: 'IP required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If login succeeded, reset counter
    if (success) {
      await supabase.from('login_attempts').delete().eq('ip_address', ip);
      return new Response(JSON.stringify({ allowed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check current attempts
    const { data: existing } = await supabase
      .from('login_attempts')
      .select('*')
      .eq('ip_address', ip)
      .maybeSingle();

    if (existing) {
      // Check if locked
      if (existing.locked_until && new Date(existing.locked_until) > new Date()) {
        return new Response(JSON.stringify({ 
          allowed: false, 
          locked_until: existing.locked_until,
          message: 'Too many failed attempts. Try again later.' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const newAttempts = (existing.attempts || 0) + 1;
      const updates: Record<string, unknown> = { attempts: newAttempts };
      
      if (newAttempts >= 5) {
        // Lock for 1 hour
        const lockUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        updates.locked_until = lockUntil;
        updates.attempts = 0;
      }

      await supabase.from('login_attempts').update(updates).eq('ip_address', ip);

      return new Response(JSON.stringify({ 
        allowed: newAttempts < 5,
        attempts: newAttempts,
        ...(newAttempts >= 5 ? { locked_until: updates.locked_until, message: 'Too many failed attempts. Try again in 1 hour.' } : {}),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      // First attempt
      await supabase.from('login_attempts').insert({ ip_address: ip, attempts: 1 });
      return new Response(JSON.stringify({ allowed: true, attempts: 1 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
