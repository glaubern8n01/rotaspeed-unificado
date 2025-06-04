
// /// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
// /// <reference lib="deno.ns" />
/// <reference lib="dom" />
/// <reference lib="esnext" />

declare const Deno: any;

// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables top-level await, reading files from the DENO_DIR CACHE, and more.

// Setup type checking in a Xanny editor like VS Code:
// https://deno.land/manual/getting_started/configuration_file

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@^2.44.4';

console.log("Daily Reset Function - Initializing");

// WARNING: Never expose your service_role key publicly or in client-side code.
// This function should be invoked by a Supabase Cron Job, where environment variables are secure.
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Supabase URL or Service Role Key not provided in environment variables.");
  Deno.exit(1);
}

const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    // autoRefreshToken: false, // Not needed for service_role
    // persistSession: false, // Not needed for service_role
  }
});

Deno.serve(async (_req: Request) => {
  // This function should ideally be protected, e.g. by checking a secret header if invoked via HTTP directly,
  // or rely on Supabase Cron Job's secure invocation.
  // For Supabase Cron, direct invocation protection might not be as critical if the function URL isn't public.

  console.log("Daily Reset Function - Invoked");

  try {
    const { data, error } = await supabaseAdmin
      .from('usuarios_rotaspeed')
      .update({ entregas_hoje: 0 })
      .neq('entregas_hoje', 0); // Only update rows where entregas_hoje is not already 0

    if (error) {
      console.error('Error resetting daily counts:', error);
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const count = data ? (Array.isArray(data) ? data.length : 1) : 0; // Supabase v2 update might return data differently
    console.log(`Successfully reset 'entregas_hoje' for users. Count of users updated might not be directly available or might be ${count}.`);
    
    // A more accurate way to get count if 'data' is null or not an array of updated rows:
    // const { count: updatedCount, error: countError } = await supabaseAdmin
    //   .from('usuarios_rotaspeed')
    //   .select('*', { count: 'exact', head: true })
    //   .eq('entregas_hoje', 0); // This counts users who now have 0, not necessarily who were updated.

    // For simplicity, we'll just log success.
    return new Response(JSON.stringify({ success: true, message: `Daily counts reset. ${count > 0 ? `${count} users potentially affected.` : ''}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('Critical error in daily reset function:', e);
    return new Response(JSON.stringify({ success: false, message: e.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// Example of how to test this function locally using Deno run:
// You'd need to set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your env.
// deno run --allow-all supabase/functions/reset-daily-counts/index.ts
// Then curl http://localhost:8000 (or the port Deno serves on)

// Note: The `_req` parameter is unused, but Deno.serve expects a function that can handle a Request.
// If you need to check for a specific cron job header for security:
// const CRON_SECRET = Deno.env.get('CRON_SECRET');
// const requestCronSecret = _req.headers.get('X-Cron-Secret');
// if (!CRON_SECRET || requestCronSecret !== CRON_SECRET) {
//   return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 });
// }
