import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@^2.44.4';
// FIX: Ensure EntregaDbRecord is imported if its definition is used for mapping
// FIX: Ensure InputType is imported as it's used in type casting
import type { User, PackageInfo, AddressInfo, EntregaDbRecord, InputType } from './types'; 

// Use the user's provided Supabase project ID
export const supabaseUrl: string = 'https://zhjzqrddmigczdfxvfhp.supabase.co'; 
export const supabaseAnonKey: string = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoanpxcmRkbWlnY3pkZnh2ZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcyNjM3MDMsImV4cCI6MjA2MjgzOTcwM30.U5l5VEIg4WI7aDS6QbsQRqMAWx6HGgkmDEOObWOnYc8'; 

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// --- Status Mapping Functions (inalterados) ---
export const mapDBStatusToPackageStatus = (dbStatus: EntregaDbRecord['status']): PackageInfo['status'] => {
  switch (dbStatus) {
    case 'pendente': return 'pending';
    case 'em_rota': return 'in_transit';
    case 'entregue': return 'delivered';
    case 'cancelada': return 'cancelled';
    case 'nao_entregue': return 'undeliverable';
    default:
      console.warn(`Unhandled DB status: ${dbStatus}, defaulting to 'pending' for PackageInfo.`);
      return 'pending';
  }
};
export const mapPackageStatusToDBStatus = (packageStatus: PackageInfo['status']): EntregaDbRecord['status'] => {
  switch (packageStatus) {
    case 'pending': return 'pendente';
    case 'in_transit': return 'em_rota';
    case 'delivered': return 'entregue';
    case 'cancelled': return 'cancelada';
    case 'undeliverable': return 'nao_entregue';
    case 'parsed': 
    case 'error':
      console.warn(`Package status ${packageStatus} mapped to 'pendente' for DB operation.`);
      return 'pendente';
    default:
      console.warn(`Unhandled PackageInfo status: ${packageStatus}, defaulting to 'pendente' for DB.`);
      return 'pendente';
  }
};

// Helper to map DB record to PackageInfo (inalterado)
const mapDbRecordToPackageInfo = (dbRecord: EntregaDbRecord): PackageInfo => {
  const { full_address, recipient_name, original_input, input_type, status: dbStatus, ...rest } = dbRecord;
  return {
    ...rest,
    fullAddress: full_address,
    recipientName: recipient_name ?? undefined,
    originalInput: original_input ?? undefined,
    inputType: input_type ? (input_type as InputType) : undefined,
    status: mapDBStatusToPackageStatus(dbStatus),
  };
};

// Helper function to get or create user profile via Edge Function
export const getUserProfile = async (userId: string, email?: string): Promise<User | null> => {
  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/sync-user-profile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email }),
      }
    );
    if (!res.ok) {
      console.error(`sync-user-profile returned status ${res.status}`);
      return null;
    }
    const { profile } = await res.json();
    return profile as User;
  } catch (e: any) {
    console.error('Error invoking sync-user-profile:', e);
    return null;
  }
};

// Client-side wrapper (supabase-js) for invoke
export const invokeSyncUserProfile = async (
  userId: string, 
  email?: string, 
  userMetadata?: { full_name?: string }
): Promise<User | null> => {
  try {
    const { data, error } = await supabase.functions.invoke('sync-user-profile', {
      body: { userId, email, nome: userMetadata?.full_name }
    });
    if (error) {
      console.error('Error invoking sync-user-profile Edge Function:', error);
      return null;
    }
    return data?.profile as User ?? null;
  } catch (e: any) {
    console.error("Exception while invoking sync-user-profile:", e);
    return null;
  }
};

// --- Entregas functions (inalterados) ---
export interface EntregaData extends Omit<PackageInfo, 'id'|'status'|'order'|'created_at'|'optimized_order'|'updated_at'> {
  user_id: string;
  status: EntregaDbRecord['status'];
  optimized_order?: number|null;
  route_id?: string|null;
  delivery_notes?: string|null;
}

export const addEntrega = async (entregaData: EntregaData): Promise<PackageInfo| null> => {
  const { data, error } = await supabase.from('entregas').insert([entregaData]).select().single();
  if (error) { console.error('Error adding entrega:', error); throw error; }
  return data ? mapDbRecordToPackageInfo(data as EntregaDbRecord) : null;
};

export const addMultipleEntregas = async (entregasData: EntregaData[]): Promise<PackageInfo[]> => {
  if (!entregasData.length) return [];
  const { data, error } = await supabase.from('entregas').insert(entregasData).select();
  if (error) { console.error('Error adding multiple entregas:', error); throw error; }
  return data.map(d => mapDbRecordToPackageInfo(d as EntregaDbRecord));
};

export const getEntregasByUserId = async (userId: string): Promise<PackageInfo[]> => {
  const { data, error } = await supabase.from('entregas').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) { console.error('Error fetching entregas:', error); throw error; }
  return data.map(d => mapDbRecordToPackageInfo(d as EntregaDbRecord));
};

export const updateEntregaStatus = async (entregaId: string, status: EntregaDbRecord['status'], order?: number): Promise<PackageInfo|null> => {
  const payload: any = { status };
  if (order != null) payload.optimized_order = order;
  const { data, error } = await supabase.from('entregas').update(payload).eq('id', entregaId).select().single();
  if (error) { console.error(`Error updating entrega ${entregaId}:`, error); throw error; }
  return data ? mapDbRecordToPackageInfo(data as EntregaDbRecord) : null;
};

export const updateMultipleEntregasOptimization = async (
  updates: Array<{ id: string; optimized_order: number; route_id: string; status: EntregaDbRecord['status'] }>
): Promise<PackageInfo[]> => {
  const results: PackageInfo[] = [];
  for (const u of updates) {
    const { data, error } = await supabase.from('entregas')
      .update({ optimized_order: u.optimized_order, route_id: u.route_id, status: u.status })
      .eq('id', u.id).select().single();
    if (error) console.error(`Error updating entrega ${u.id}:`, error);
    else if (data) results.push(mapDbRecordToPackageInfo(data as EntregaDbRecord));
  }
  return results;
};

export const deleteEntrega = async (entregaId: string): Promise<boolean> => {
  const { error } = await supabase.from('entregas').delete().eq('id', entregaId);
  if (error) { console.error(`Error deleting entrega ${entregaId}:`, error); throw error; }
  return true;
};

export const updateUserProfileSettings = async (userId: string, settings: Partial<User>): Promise<User|null> => {
  const { data, error } = await supabase.from('usuarios_rotaspeed').update(settings).eq('id', userId).select().single();
  if (error) { console.error('Error updating user settings:', error); throw error; }
  return data as User;
};
