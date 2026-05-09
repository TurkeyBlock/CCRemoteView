'use client'

import { useState } from 'react'
import { useUserStore } from '@/store/useUser'

export default function OperatorRequest() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const isLoggedIn = useUserStore(s => s.isLoggedIn)

  async function request() {
    setLoading(true)
    const res = await fetch('/api/requestOperator', { method: 'POST' }).catch(() => null)
    if (!res) { setMessage('Could not reach server.'); setLoading(false); return }
    const data = await res.json()
    if (data.result === 'ok') { setMessage('Request submitted. An admin will review it.'); await useUserStore.getState().fetchMe() }
    else if (data.result === 'already_requested') setMessage('You already have a pending request.')
    else if (data.result === 'already_operator') setMessage('You are already an operator.')
    else setMessage('Something went wrong.')
    setLoading(false)
  }

  const panelStyle: React.CSSProperties = { background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', fontSize: '0.85em' }
  const toggleStyle: React.CSSProperties = { background: 'none', border: 'none', color: 'gray', cursor: 'pointer', fontSize: '0.85em', padding: 0 }
  const actionStyle: React.CSSProperties = { display: 'inline-block', marginTop: 4, padding: '3px 10px', borderRadius: 4, border: 'none', background: 'rgb(52,52,52)', color: 'darkgray', cursor: 'pointer', fontSize: '1em', textDecoration: 'none' }

  return (
    <div style={panelStyle}>
      <button onClick={() => setOpen(o => !o)} style={toggleStyle}>{open ? '▾' : '▸'} Operator access</button>
      {open && (
        <div>
          {!isLoggedIn
            ? <a href="/api/signin" style={actionStyle}>Sign in</a>
            : message
              ? <p style={{ margin: '4px 0 0 0', color: 'darkgray', fontStyle: 'italic' }}>{message}</p>
              : <button onClick={request} disabled={loading} style={{ ...actionStyle, opacity: loading ? 0.5 : 1, cursor: loading ? 'default' : 'pointer' }}>Request access</button>
          }
        </div>
      )}
    </div>
  )
}
