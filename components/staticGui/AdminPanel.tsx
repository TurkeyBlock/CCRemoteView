'use client'

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useUserStore } from '@/store/useUser'
import { isStale } from '@/utils/stale'

interface Props { onOpened?: () => void }
export interface PanelHandle { setOpen: (v: boolean) => void }

const AdminPanel = forwardRef<PanelHandle, Props>(function AdminPanel({ onOpened }, ref) {
  const [open, setOpen] = useState(false)
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

  const panelStyle: React.CSSProperties = { position: 'relative', background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px' }
  const dropdownStyle: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, zIndex: 100, background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', minWidth: 220, marginTop: 2 }
  const toggleBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: 'gray', cursor: 'pointer', fontSize: '0.85em', padding: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }
  const approveBtnStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: 4, border: 'none', background: 'rgb(60,120,60)', color: 'white', cursor: 'pointer', fontSize: '0.8em' }
  const revokeBtnStyle: React.CSSProperties = { ...approveBtnStyle, background: 'rgb(120,50,50)' }
  const ipRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4, fontSize: '0.85em', color: 'darkgray' }
  const sectionH3: React.CSSProperties = { margin: '0 0 6px 0', fontSize: '0.85em', color: 'darkgray', textTransform: 'uppercase', letterSpacing: '0.05em' }
  const divider: React.CSSProperties = { border: 'none', borderTop: '1px solid rgb(60,60,60)', margin: '10px 0' }

  return (
    <div style={panelStyle}>
      <button onClick={toggle} style={toggleBtnStyle}>{open ? '▾' : '▸'} Admin</button>
      {open && (
        <div style={dropdownStyle}>
          {pending.length > 0 ? (
            <div>
              <p style={{ margin: '0 0 4px 0', fontSize: '0.75em', color: 'gray' }}>Pending</p>
              {pending.map(ip => (
                <div key={ip} style={ipRowStyle}>
                  <span>{ip}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={approveBtnStyle} onClick={() => post('/api/admin/approveComputer', { ip })}>Approve</button>
                    <button style={revokeBtnStyle} onClick={() => post('/api/admin/denyComputer', { ip })}>Deny</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p style={{ margin: 0, fontSize: '0.8em', color: 'gray' }}>No pending turtles.</p>}

          {approved.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '0.75em', color: 'gray' }}>Approved IPs</p>
              {approved.map(ip => (
                <div key={ip} style={ipRowStyle}>
                  <span>{ip}</span>
                  <button style={revokeBtnStyle} onClick={() => post('/api/admin/revokeComputer', { ip })}>Revoke</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '0.75em', color: 'gray' }}>Pending Turtle IDs</p>
            {pendingIds.length > 0 ? pendingIds.map(t => (
              <div key={t.id} style={ipRowStyle}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ color: 'darkgray' }}>ID {t.id}</span>
                  <span style={{ fontSize: '0.75em', color: 'gray' }}>from {t.ip}</span>
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button style={approveBtnStyle} onClick={() => post('/api/admin/approveComputerId', { id: t.id })}>Approve</button>
                  <button style={revokeBtnStyle} onClick={() => post('/api/admin/denyComputerId', { id: t.id })}>Deny</button>
                </div>
              </div>
            )) : <p style={{ margin: 0, fontSize: '0.8em', color: 'gray' }}>No pending turtle IDs.</p>}
          </div>

          {approvedIds.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '0.75em', color: 'gray' }}>Approved Turtle IDs</p>
              {approvedIds.map(id => (
                <div key={id} style={ipRowStyle}>
                  <span>ID {id}</span>
                  <button style={revokeBtnStyle} onClick={() => post('/api/admin/revokeComputerId', { id })}>Revoke</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
            <label style={{ fontSize: '0.8em', color: 'rgb(220,160,40)', fontWeight: 'bold' }}>⚠ Allow by IP (override)</label>
            <input type="checkbox" checked={allowByIp} onChange={e => handleSetAllowByIp(e.target.checked)} />
          </div>
          {allowByIp && (
            <p style={{ fontSize: '0.75em', color: 'rgb(200,130,30)', margin: '4px 0 0 0', padding: '4px 6px', background: 'rgb(60,40,10)', border: '1px solid rgb(120,80,20)', borderRadius: 4 }}>
              Any turtle from an approved IP can connect without individual ID approval.
            </p>
          )}

          <hr style={divider} />
          <h3 style={sectionH3}>Operator Requests</h3>
          {operatorRequests.length > 0 ? operatorRequests.map(r => (
            <div key={r.sub} style={ipRowStyle}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'darkgray' }}>{r.email}</span>
                <span style={{ fontSize: '0.75em', color: 'gray' }}>{r.sub}</span>
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={approveBtnStyle} onClick={() => handleApproveOperator(r.sub)}>Approve</button>
                <button style={revokeBtnStyle} onClick={() => handleDenyOperator(r.sub)}>Deny</button>
              </div>
            </div>
          )) : <p style={{ margin: 0, fontSize: '0.8em', color: 'gray' }}>No pending requests.</p>}

          {operators.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <h3 style={sectionH3}>Operators</h3>
              {operators.map(op => (
                <div key={op.sub} style={ipRowStyle}>
                  <span style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <span style={{ color: 'darkgray' }}>{op.email ?? '—'}</span>
                    <span style={{ fontSize: '0.75em', color: 'gray' }}>{op.sub}</span>
                  </span>
                  <button style={revokeBtnStyle} onClick={() => handleRevokeOperator(op.sub)}>Revoke</button>
                </div>
              ))}
            </div>
          )}

          <hr style={divider} />
          <h3 style={sectionH3}>Turtles</h3>
          {Object.keys(computers).length > 0 ? Object.entries(computers).map(([id, turtle]) => (
            <div key={id} style={ipRowStyle}>
              <span style={isStale(turtle) ? { color: 'rgb(180,140,40)' } : {}}>
                #{id} {turtle.label ?? ''}
                {isStale(turtle) && <span style={{ fontSize: '0.75em', opacity: 0.8 }}> (stale)</span>}
              </span>
              <button style={revokeBtnStyle} onClick={() => deleteComputer(id)}>Delete</button>
            </div>
          )) : <p style={{ margin: 0, fontSize: '0.8em', color: 'gray' }}>No tracked turtles.</p>}

          <hr style={divider} />
          <button
            disabled={clearingWorld}
            onClick={handleClearWorld}
            style={{ padding: 4, width: '100%', marginTop: 4, borderRadius: 4, border: 'none', cursor: 'pointer', background: clearingWorld ? 'rgb(80,40,10)' : 'rgb(140,60,20)', color: 'white', fontSize: '0.85em' }}
          >
            {clearingWorld ? '⟳ Clearing...' : 'Clear World'}
          </button>
        </div>
      )}
    </div>
  )
})

export default AdminPanel
