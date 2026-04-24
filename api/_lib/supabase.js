import { createClient } from '@supabase/supabase-js';

let _client;

export function getSupabase() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _client;
}

// Alias para compatibilidade com os handlers que usam supabaseAdmin diretamente
export const supabaseAdmin = new Proxy({}, {
  get(_, prop) { return getSupabase()[prop]; },
});
