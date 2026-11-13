import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

/** The browser client, or null when Supabase isn't configured (the UI then stays signed out). */
export function createClient() {
  const env = getSupabaseEnv()
  if (!env) return null
  return createBrowserClient(env.url, env.key)
}
