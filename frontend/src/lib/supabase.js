import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// If no Supabase config, auth is disabled (local dev mode)
export const isAuthEnabled = !!(supabaseUrl && supabaseAnonKey)

// Singleton client instance (avoids session sync issues with multiple instances)
let _client = null

export function createClient() {
  if (!isAuthEnabled) return null
  if (!_client) {
    _client = createBrowserClient(supabaseUrl, supabaseAnonKey)
  }
  return _client
}

// Module-level token cache updated by AuthProvider
let _accessToken = null

export function setAccessToken(token) {
  _accessToken = token
}

export function getAccessToken() {
  return _accessToken
}
