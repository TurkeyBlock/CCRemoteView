'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'

interface Props { computerId: number }

export default function ModemPanel({ computerId }: Props) {
  const computers = useWorldStore(s => s.computers)
  const modemServerId = useWorldStore(s => s.modemServerId)
  const setSelectedComputerId = useWorldViewStore(s => s.setSelectedComputerId)
  const followComputer = useWorldViewStore(s => s.followComputer)

  const clients = Object.keys(computers)
    .map(Number)
    .filter(id => id !== computerId && computers[id]?.via_modem)

  function selectComputer(id: number) {
    setSelectedComputerId(id)
    followComputer(id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: '0.9em', fontWeight: 'bold', color: 'rgb(120,180,240)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
        📡 Modem Server {computerId}
        <span style={{ fontSize: '0.8em', fontWeight: 'normal', letterSpacing: '0.04em', textTransform: 'uppercase', color: modemServerId !== null ? 'rgb(80,200,80)' : 'rgb(120,120,120)' }}>
          {modemServerId !== null ? 'online' : 'offline'}
        </span>
      </div>

      <div>
        <div style={{ fontSize: '0.75em', color: 'gray', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
          Routing {clients.length} computer{clients.length !== 1 ? 's' : ''}
        </div>
        {clients.length === 0 ? (
          <div style={{ fontSize: '0.8em', color: 'gray', fontStyle: 'italic' }}>No computers currently routing through this modem.</div>
        ) : clients.map(id => (
          <div
            key={id}
            onClick={() => selectComputer(id)}
            style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: '0.85em', padding: '3px 6px', borderRadius: 3, cursor: 'pointer', color: 'darkgray' }}
          >
            <span style={{ color: 'gray', fontSize: '0.9em' }}>{computers[id]?.type === 'minecart' ? 'Minecart' : 'Turtle'}</span>
            <span style={{ color: 'rgb(120,180,240)', fontWeight: 'bold', minWidth: 24 }}>{id}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{computers[id]?.label}</span>
          </div>
        ))}
      </div>

      <LuaTerminal computerId={computerId} />
    </div>
  )
}
