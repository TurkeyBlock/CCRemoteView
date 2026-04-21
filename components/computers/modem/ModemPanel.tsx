'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'

interface Props { computerId: number }

const TYPE_LABEL: Record<string, string> = {
  turtle: 'Turtle', minecart: 'Minecart', stationary: 'Stationary', player: 'Player',
}

export default function ModemPanel({ computerId }: Props) {
  const computers = useWorldStore(s => s.computers)
  const modemServerId = useWorldStore(s => s.modemServerId)
  const setModemEnabled = useWorldStore(s => s.setModemEnabled)
  const setSelectedComputerId = useWorldViewStore(s => s.setSelectedComputerId)
  const followComputer = useWorldViewStore(s => s.followComputer)

  const clients = Object.keys(computers)
    .map(Number)
    .filter(id => id !== computerId && computers[id]?.type !== 'modem')
    .sort((a, b) => a - b)

  const routing = clients.filter(id => computers[id]?.via_modem)

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
        <div style={{ fontSize: '0.75em', color: 'gray', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Routing {routing.length} / {clients.length} computer{clients.length !== 1 ? 's' : ''}
        </div>
        {clients.length === 0 ? (
          <div style={{ fontSize: '0.8em', color: 'gray', fontStyle: 'italic' }}>No computers registered.</div>
        ) : clients.map(id => {
          const c = computers[id]
          const hasPeripheral = c?.has_modem_peripheral === true
          const modemEnabled = c?.modem_enabled !== false
          return (
            <div key={id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.85em', padding: '3px 6px', borderRadius: 3, color: 'darkgray' }}>
              <span
                onClick={() => selectComputer(id)}
                style={{ display: 'flex', gap: 6, alignItems: 'baseline', cursor: 'pointer', flex: 1, minWidth: 0 }}
              >
                <span style={{ color: 'gray', fontSize: '0.9em', flexShrink: 0 }}>{TYPE_LABEL[c?.type ?? ''] ?? 'Turtle'}</span>
                <span style={{ color: 'rgb(120,180,240)', fontWeight: 'bold', minWidth: 24, flexShrink: 0 }}>{id}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c?.label}</span>
              </span>
              <span style={{ fontSize: '0.8em', color: c?.via_modem ? 'rgb(80,200,80)' : 'rgb(80,80,80)', flexShrink: 0 }}>
                {c?.via_modem ? '📡' : '⟳'}
              </span>
              <label
                title={hasPeripheral ? 'Toggle modem mode (queues reboot)' : 'No modem peripheral detected'}
                style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: hasPeripheral ? 'pointer' : 'not-allowed', flexShrink: 0 }}
              >
                <input
                  type="checkbox"
                  checked={modemEnabled}
                  disabled={!hasPeripheral}
                  onChange={e => setModemEnabled(id, e.target.checked)}
                  style={{ cursor: hasPeripheral ? 'pointer' : 'not-allowed', accentColor: 'rgb(120,180,240)' }}
                />
              </label>
            </div>
          )
        })}
      </div>

      <LuaTerminal computerId={computerId} />
    </div>
  )
}
