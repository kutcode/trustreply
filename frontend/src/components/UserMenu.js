'use client'

import { useAuth } from './AuthProvider'

export default function UserMenu() {
  const { user, signOut, isAuthEnabled } = useAuth()

  if (!isAuthEnabled || !user) return null

  return (
    <div style={styles.wrapper}>
      <span style={styles.email} title={user.email}>{user.email}</span>
      <button onClick={signOut} style={styles.button}>Sign Out</button>
    </div>
  )
}

const styles = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 13,
  },
  email: {
    color: 'var(--text-secondary)',
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  button: {
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid var(--border-color)',
    background: 'var(--bg-card)',
    color: 'var(--color-danger)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.15s',
  },
}
