// --- Helper to get or create user profile via Edge Function ---  
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
  } catch (e) {
    console.error('Error invoking sync-user-profile:', e);
    return null;
  }
};

// --- Client-side wrapper for invoking via supabase-js (optional) ---  
export const invokeSyncUserProfile = async (
  userId: string,
  email?: string,
  userMetadata?: { full_name?: string }
): Promise<User | null> => {
  try {
    const { data, error } = await supabase.functions.invoke('sync-user-profile', {
      body: { userId, email, nome: userMetadata?.full_name },
    });
    if (error) {
      console.error('Error invoking sync-user-profile Edge Function:', error);
      return null;
    }
    return data?.profile as User ?? null;
  } catch (e) {
    console.error('Exception while invoking sync-user-profile:', e);
    return null;
  }
};
