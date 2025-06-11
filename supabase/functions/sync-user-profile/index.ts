/// <reference lib="dom" />
/// <reference lib="esnext" />

declare const Deno: any;
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@^2.44.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY");
}
const supabaseAdmin: SupabaseClient = createClient(supabaseUrl!, supabaseServiceRoleKey!);

Deno.serve(async (req: Request) => {
  // **CORS**: adicionamos x-client-info aqui
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info',
  };

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Só aceitamos POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: "Use POST" }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Parse JSON
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ message: 'JSON inválido.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const { userId, email, nome: nomeFromClient } = body;
  if (!userId) {
    return new Response(JSON.stringify({ message: "Falta 'userId' no body." }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Verifica se já existe
    const { data: existing, error: errFetch } = await supabaseAdmin
      .from('usuarios_rotaspeed')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (errFetch) throw errFetch;

    if (existing) {
      return new Response(JSON.stringify({ profile: existing, message: "Profile already exists." }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Cria novo perfil
    const newProfile = {
      id: userId,
      email,
      nome: nomeFromClient || email?.split('@')[0] || 'Novo Usuário',
      plano_nome: 'Grátis',
      entregas_dia_max: 10,
      entregas_hoje: 0,
      saldo_creditos: 0,
      plano_ativo: true,
      entregas_gratis_utilizadas: 0,
      driver_name: nomeFromClient || 'Entregador',
      driver_phone: '',
      navigation_preference: 'google',
      notification_sender_preference: 'driver',
    };
    const { data: created, error: errInsert } = await supabaseAdmin
      .from('usuarios_rotaspeed')
      .insert(newProfile)
      .select()
      .single();
    if (errInsert) throw errInsert;

    return new Response(JSON.stringify({ profile: created, message: "Profile created." }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
