// The two clients under comparison, both set to schema "platform", as apps' platform-server client is.
// Used by the local scripts and by the Netlify functions, so both sides are called the same way everywhere.
import { createClient as createSupabase } from "@supabase/supabase-js";
import { createClient as createNeon } from "@neon/neon-js";

/** Supabase (PostgREST) as the apps reach it: the anon key as apikey, the user's or service token as bearer. */
export function supabaseClient(url, apiKey, token) {
  return createSupabase(url, apiKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: "platform" },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
}

/** The Neon Data API through Neon's supabase-js-shaped client, with our own token. */
export function neonClient(dataApiUrl, getToken) {
  return createNeon({
    dataApi: { url: dataApiUrl, getToken: async () => getToken(), options: { db: { schema: "platform" } } },
  });
}
