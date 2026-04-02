'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient, isAuthEnabled, setAccessToken } from '@/lib/supabase'
import LoginPage from './LoginPage'

const AuthContext = createContext({ user: null, signOut: () => {}, isAuthEnabled: false })

export function useAuth() {
  return useContext(AuthContext)
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(isAuthEnabled)
  const supabase = createClient()

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAccessToken(session?.access_token ?? null)
      setLoading(false)
    })

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAccessToken(session?.access_token ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut()
      setUser(null)
      setAccessToken(null)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div className="skeleton-line" style={{ width: 200, height: 20 }} />
      </div>
    )
  }

  // If auth is enabled but no user, show login
  if (isAuthEnabled && !user) {
    return <LoginPage />
  }

  return (
    <AuthContext.Provider value={{ user, signOut, isAuthEnabled }}>
      {children}
    </AuthContext.Provider>
  )
}
