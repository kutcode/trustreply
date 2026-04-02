'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const [tab, setTab] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const supabase = createClient()

  const handlePasswordLogin = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw authError
    } catch (err) {
      setError(err.message || 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleMagicLink = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({ email })
      if (authError) throw authError
      setMessage('Check your email for the login link.')
    } catch (err) {
      setError(err.message || 'Failed to send magic link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.logo}>🤖</span>
          <h1 style={styles.title}>TrustReply</h1>
          <p style={styles.subtitle}>Sign in to continue</p>
        </div>

        <div style={styles.tabs}>
          <button
            style={tab === 'password' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
            onClick={() => { setTab('password'); setError(''); setMessage('') }}
          >
            Password
          </button>
          <button
            style={tab === 'magic' ? { ...styles.tab, ...styles.tabActive } : styles.tab}
            onClick={() => { setTab('magic'); setError(''); setMessage('') }}
          >
            Magic Link
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {message && <div style={styles.success}>{message}</div>}

        {tab === 'password' ? (
          <form onSubmit={handlePasswordLogin} style={styles.form}>
            <label style={styles.label}>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={styles.input}
                placeholder="you@company.com"
              />
            </label>
            <label style={styles.label}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={styles.input}
                placeholder="Your password"
              />
            </label>
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMagicLink} style={styles.form}>
            <label style={styles.label}>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={styles.input}
                placeholder="you@company.com"
              />
            </label>
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? 'Sending...' : 'Send Magic Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

const styles = {
  wrapper: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: 'var(--bg-primary)',
    padding: 16,
  },
  card: {
    background: 'var(--card-bg, var(--bg-card))',
    borderRadius: 12,
    boxShadow: 'var(--shadow-lg)',
    padding: '40px 36px',
    width: '100%',
    maxWidth: 400,
  },
  header: {
    textAlign: 'center',
    marginBottom: 24,
  },
  logo: {
    fontSize: 40,
    display: 'block',
    marginBottom: 8,
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  subtitle: {
    margin: '6px 0 0',
    fontSize: 14,
    color: 'var(--text-secondary)',
  },
  tabs: {
    display: 'flex',
    gap: 0,
    marginBottom: 20,
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
  },
  tab: {
    flex: 1,
    padding: '10px 0',
    border: 'none',
    background: 'var(--surface-alt)',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    transition: 'all 0.15s',
  },
  tabActive: {
    background: 'var(--accent-primary)',
    color: '#fff',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
  },
  input: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border-color)',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  button: {
    padding: '12px 0',
    borderRadius: 8,
    border: 'none',
    background: 'var(--accent-primary)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 4,
    transition: 'background 0.15s',
  },
  error: {
    background: 'var(--error-bg)',
    color: 'var(--error)',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  success: {
    background: 'var(--success-bg)',
    color: 'var(--success)',
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 8,
  },
}
