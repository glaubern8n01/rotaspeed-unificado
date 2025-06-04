
// /// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
// /// <reference lib="deno.ns" />
/// <reference lib="dom" />
/// <reference lib="esnext" />

declare const Deno: any;

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@^2.44.4';

// Define simple interface for User profile data for clarity
// This should align with your frontend `User` type and `usuarios_rotaspeed` table
interface UserProfile {
  id: string;
  email?: string;
  nome?: string | null;
  plano_nome: string;
  entregas_dia_max: number;
  entregas_hoje: number;
  saldo_creditos: number;
  plano_ativo: boolean;
  entregas_gratis_utilizadas: number;
  driver_name?: string | null;
  driver_phone?: string | null;
  navigation_preference?: string;
  notification_sender_preference?: string;
  created_at?: string;
  updated_at?: string;
}


// These should be set as Environment Variables in your Supabase project settings
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("CRITICAL: Supabase URL or Service Role Key not provided for sync-user-profile function.");
  // Deno.exit(1); // Exiting might not be best for a serve function, but indicates critical failure
}

// Initialize Supabase client with service_role key for admin-level access
const supabaseAdmin: SupabaseClient = createClient(supabaseUrl!, supabaseServiceRoleKey!);

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*', // Adjust for your frontend URL in production
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Authorization for user's JWT
      },
      status: 204,
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: "Method not allowed. Please use POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let requestBody;
  try {
    requestBody = await req.json();
  } catch (error) {
    return new Response(JSON.stringify({ message: "Invalid JSON payload." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { userId, email, nome: nomeFromClient } = requestBody;

  if (!userId) {
    return new Response(JSON.stringify({ message: "Missing 'userId' in request body." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  
  // Optional: Verify JWT if you want to ensure the user invoking this is the one they claim to be.
  // const authHeader = req.headers.get('Authorization');
  // if (!authHeader || !authHeader.startsWith('Bearer ')) {
  //   return new Response(JSON.stringify({ message: 'Missing or invalid Authorization Bearer token' }), 
  //     { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  // }
  // const token = authHeader.replace('Bearer ', '');
  // const { data: { user:authUser }, error:userError } = await supabaseAdmin.auth.getUser(token);
  // if (userError || !authUser || authUser.id !== userId) {
  //   return new Response(JSON.stringify({ message: 'Invalid token or user mismatch' }), 
  //     { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  // }


  try {
    // 1. Check if profile already exists
    const { data: existingProfile, error: fetchError } = await supabaseAdmin
      .from('usuarios_rotaspeed')
      .select('*')
      .eq('id', userId)
      .maybeSingle(); // Use maybeSingle to handle 0 or 1 row

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 is 'tansaction returned no rows'
      console.error('Error fetching existing profile:', fetchError);
      throw fetchError;
    }

    if (existingProfile) {
      console.log(`Profile already exists for user ${userId}.`);
      // If admin logged in and profile existed but wasn't admin, update it (optional enhancement)
      if (email === 'glaubercontatos@outlook.com' && existingProfile.plano_nome !== 'Admin Ilimitado') {
          const { data: updatedAdminProfile, error: adminUpdateError } = await supabaseAdmin
              .from('usuarios_rotaspeed')
              .update({
                  plano_nome: 'Admin Ilimitado',
                  entregas_dia_max: 99999,
                  saldo_creditos: 99999,
                  plano_ativo: true,
                  nome: nomeFromClient || existingProfile.nome || email.split('@')[0],
                  driver_name: existingProfile.driver_name || 'Glauber (Admin)',
              })
              .eq('id', userId)
              .select()
              .single();
          if (adminUpdateError) {
              console.error('Error updating existing profile to Admin plan:', adminUpdateError);
              // Fallback to returning the original existing profile
              return new Response(JSON.stringify({ profile: existingProfile, message: "Profile already exists." }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
          }
          return new Response(JSON.stringify({ profile: updatedAdminProfile, message: "Admin profile updated." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      return new Response(JSON.stringify({ profile: existingProfile, message: "Profile already exists." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // 2. Profile does not exist, create it
    console.log(`Profile not found for user ${userId}. Creating new profile...`);
    const normalizedEmail = email?.toLowerCase();
    const isAdminEmail = normalizedEmail === 'glaubercontatos@outlook.com';
    
    let newUserProfileData: Omit<UserProfile, 'created_at' | 'updated_at'>; // DB handles timestamps

    if (isAdminEmail) {
      newUserProfileData = {
        id: userId,
        email: email,
        nome: nomeFromClient || 'Glauber Administrador',
        plano_nome: 'Admin Ilimitado',
        entregas_dia_max: 99999,
        entregas_hoje: 0,
        saldo_creditos: 99999,
        plano_ativo: true,
        entregas_gratis_utilizadas: 0,
        driver_name: 'Glauber (Admin)',
        driver_phone: '',
        navigation_preference: 'google',
        notification_sender_preference: 'driver',
      };
    } else {
      newUserProfileData = {
        id: userId,
        email: email,
        nome: nomeFromClient || email?.split('@')[0] || 'Novo Usuário', // Use nome from client, or derive from email
        plano_nome: 'Grátis', // Default to "Grátis" plan for 10 free deliveries
        entregas_dia_max: 10,
        entregas_hoje: 0,
        saldo_creditos: 0,
        plano_ativo: true,
        entregas_gratis_utilizadas: 0,
        driver_name: nomeFromClient || 'Entregador RotaSpeed', // Default driver name
        driver_phone: '',
        navigation_preference: 'google',
        notification_sender_preference: 'driver',
      };
    }

    const { data: createdProfile, error: insertError } = await supabaseAdmin
      .from('usuarios_rotaspeed')
      .insert(newUserProfileData)
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting new profile:', insertError);
      // Handle potential race condition if profile was created between check and insert
      if (insertError.code === '23505') { // Unique violation (profile likely created by another call)
          const finalProfileCheck = await supabaseAdmin.from('usuarios_rotaspeed').select('*').eq('id', userId).single();
          if (finalProfileCheck.data) {
            return new Response(JSON.stringify({ profile: finalProfileCheck.data, message: "Profile created by concurrent call." }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
          }
      }
      throw insertError;
    }

    console.log(`Successfully created profile for user ${userId}.`);
    return new Response(JSON.stringify({ profile: createdProfile }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 201, // 201 Created
    });

  } catch (error) {
    console.error(`Error in sync-user-profile for userId ${userId}:`, error);
    return new Response(JSON.stringify({ message: error.message || "An internal server error occurred." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
