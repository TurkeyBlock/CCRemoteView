'use client'

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useUserStore } from '@/store/useUser'
import { isStale } from '@/utils/stale'
import { closeAllMenus } from '@/components/ui'

interface Props { onOpened?: () => void }
export interface PanelHandle { setOpen: (v: boolean) => void }

const AdminPanel = forwardRef<PanelHandle, Props>(function AdminPanel({ onOpened }, ref) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right?: number }>({ top: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  useImperativeHandle(ref, () => ({ setOpen }), [])
  const [pending, setPending] = useState<string[]>([])
  const [approved, setApproved] = useState<string[]>([])
  const [pendingIds, setPendingIds] = useState<{ id: string; ip: string; requestedAt: number }[]>([])
  const [approvedIds, setApprovedIds] = useState<string[]>([])
  const [allowByIp, setAllowByIp] = useState(true)
  const [operatorRequests, setOperatorRequests] = useState<{ sub: string; email: string; requestedAt: number }[]>([])
  const [operators, setOperators] = useState<{ sub: string; email: string | null }[]>([])
  const [clearingWorld, setClearingWorld] = useState(false)
  const pollHandle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const computers = useWorldStore(s => s.computers)
  const removeComputer = useWorldStore(s => s.removeComputer)
  const clearBlocks = useWorldStore(s => s.clearBlocks)

  useEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }, [open])

  async function fetchAll() {
    try {
      const [ips, ids, requests, ops] = await Promise.all([
        fetch('/api/admin/computerIps').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/admin/computerIds').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/admin/operatorRequests').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/admin/operators').then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      if (ips) { setPending(ips.pending); setApproved(ips.approved) }
      if (ids) { setPendingIds(ids.pending); setApprovedIds(ids.approved); setAllowByIp(ids.allowByIp) }
      if (requests) setOperatorRequests(requests)
      if (ops) setOperators(ops)
    } finally {
      pollHandle.current = setTimeout(fetchAll, 30000)
    }
  }

  useEffect(() => {
    fetchAll()
    return () => { if (pollHandle.current) clearTimeout(pollHandle.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    const next = !open
    closeAllMenus()
    setOpen(next)
    if (next) onOpened?.()
  }

  async function post(url: string, body?: object) {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    await fetchAll()
  }

  async function handleSetAllowByIp(enabled: boolean) {
    await fetch('/api/admin/setAllowByIp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    await fetchAll()
  }

  async function handleApproveOperator(sub: string) {
    await fetch('/api/admin/approveOperator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub }) })
    await Promise.all([fetchAll(), useUserStore.getState().fetchMe()])
  }

  async function handleDenyOperator(sub: string) {
    await fetch('/api/admin/denyOperatorRequest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub }) })
    await Promise.all([fetchAll(), useUserStore.getState().fetchMe()])
  }

  async function handleRevokeOperator(sub: string) {
    await fetch('/api/admin/revokeOperator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub }) })
    await Promise.all([fetchAll(), useUserStore.getState().fetchMe()])
  }

  async function deleteComputer(id: string | number) {
    await fetch('/api/admin/deleteComputer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    removeComputer(id)
    await fetchAll()
  }

  async function handleClearWorld() {
    setClearingWorld(true)
    await Promise.all([
      fetch('/api/admin/clearWorld', { method: 'POST' }).then(() => clearBlocks()),
      new Promise(r => setTimeout(r, 500)),
    ])
    setClearingWorld(false)
  }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--fg-mute)' }

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} className="btn btn-compact" onClick={toggle}>
        Admin <span style={{ marginLeft: 5, opacity: 0.55, fontSize: 9 }}>▼</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setOpen(false)} />
          <div className="dropdown" style={{ top: pos.top, right: pos.right, maxHeight: '80vh', overflowY: 'auto' }}>

            <div className="dropdown-section">
              <div className="heading">Pending turtles</div>
              {pending.length > 0 ? pending.map(ip => (
                <div key={ip} style={rowStyle}>
                  <span className="mono">{ip}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-compact" style={{ color: 'var(--green)', borderColor: 'var(--green)' }} onClick={() => post('/api/admin/approveComputer', { ip })}>Approve</button>
                    <button className="btn btn-compact btn-danger" onClick={() => post('/api/admin/denyComputer', { ip })}>Deny</button>
                  </div>
                </div>
              )) : <div className="explainer">No pending turtles.</div>}
            </div>

            {approved.length > 0 && (
              <div className="dropdown-section">
                <div className="heading">Approved IPs</div>
                {approved.map(ip => (
                  <div key={ip} style={rowStyle}>
                    <span className="mono">{ip}</span>
                    <button className="btn btn-compact btn-danger" onClick={() => post('/api/admin/revokeComputer', { ip })}>Revoke</button>
                  </div>
                ))}
              </div>
            )}

            <div className="dropdown-divider" />

            <div className="dropdown-section">
              <div className="heading">Pending Turtle IDs</div>
              {pendingIds.length > 0 ? pendingIds.map(t => (
                <div key={t.id} style={rowStyle}>
                  <span>
                    <span className="mono">ID {t.id}</span>
                    <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>from {t.ip}</span>
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-compact" style={{ color: 'var(--green)', borderColor: 'var(--green)' }} onClick={() => post('/api/admin/approveComputerId', { id: t.id })}>Approve</button>
                    <button className="btn btn-compact btn-danger" onClick={() => post('/api/admin/denyComputerId', { id: t.id })}>Deny</button>
                  </div>
                </div>
              )) : <div className="explainer">No pending turtle IDs.</div>}
            </div>

            {approvedIds.length > 0 && (
              <div className="dropdown-section">
                <div className="heading">Approved Turtle IDs</div>
                {approvedIds.map(id => (
                  <div key={id} style={rowStyle}>
                    <span className="mono">ID {id}</span>
                    <button className="btn btn-compact btn-danger" onClick={() => post('/api/admin/revokeComputerId', { id })}>Revoke</button>
                  </div>
                ))}
              </div>
            )}

            <div className="dropdown-divider" />

            <div className="dropdown-section">
              <label className="checkbox">
                <input type="checkbox" checked={allowByIp} onChange={e => handleSetAllowByIp(e.target.checked)} />
                <span className="checkbox-box" />
                <span className="checkbox-label">Allow by IP (override)</span>
              </label>
              {allowByIp && (
                <div className="callout">
                  <div className="callout-title">Override enabled</div>
                  Any turtle from an approved IP can connect without individual ID approval.
                </div>
              )}
            </div>

            <div className="dropdown-divider" />

            <div className="dropdown-section">
              <div className="heading">Operator Requests</div>
              {operatorRequests.length > 0 ? operatorRequests.map(r => (
                <div key={r.sub} style={rowStyle}>
                  <span>{r.email}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-compact" style={{ color: 'var(--green)', borderColor: 'var(--green)' }} onClick={() => handleApproveOperator(r.sub)}>Approve</button>
                    <button className="btn btn-compact btn-danger" onClick={() => handleDenyOperator(r.sub)}>Deny</button>
                  </div>
                </div>
              )) : <div className="explainer">No pending requests.</div>}
            </div>

            {operators.length > 0 && (
              <div className="dropdown-section">
                <div className="heading">Operators</div>
                {operators.map(op => (
                  <div key={op.sub} style={rowStyle}>
                    <span>{op.email ?? 'unknown'}</span>
                    <button className="btn btn-compact btn-danger" onClick={() => handleRevokeOperator(op.sub)}>Revoke</button>
                  </div>
                ))}
              </div>
            )}

            <div className="dropdown-divider" />

            <div className="dropdown-section">
              <div className="heading">Turtles</div>
              {Object.keys(computers).length > 0 ? Object.entries(computers).map(([id, turtle]) => (
                <div key={id} style={rowStyle}>
                  <span style={isStale(turtle) ? { color: 'var(--accent)' } : {}}>
                    <span className="mono">#{id}</span> {turtle.label ?? ''}
                    {isStale(turtle) && <span className="muted" style={{ fontSize: 11 }}> (stale)</span>}
                  </span>
                  <button className="btn btn-compact btn-danger" onClick={() => deleteComputer(id)}>Delete</button>
                </div>
              )) : <div className="explainer">No tracked turtles.</div>}
            </div>

            <div className="dropdown-divider" />

            <button
              className="btn btn-danger btn-block"
              disabled={clearingWorld}
              onClick={handleClearWorld}
            >
              {clearingWorld ? 'Clearing...' : 'Clear World'}
            </button>
          </div>
        </>
      )}
    </div>
  )
})

export default AdminPanel
