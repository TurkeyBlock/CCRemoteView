'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'
import { Section, Led } from '@/components/ui'

interface Props { computerId: number }

const TYPE_LABEL: Record<string, string> = {
  turtle: 'Turtle', minecart: 'Minecart', stationary: 'Stationary', player: 'Player',
}

export default function ModemPanel({ computerId }: Props) {
  const computers = useWorldStore(s => s.computers)
  const modemServerId = useWorldStore(s => s.modemServerId)
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
    <div className="group">
      <Section
        label="Modem Server"
        right={<Led kind={modemServerId !== null ? 'on' : 'off'} title={modemServerId !== null ? 'online' : 'offline'} />}
      >
        <span className="muted" style={{ fontSize: 12 }}>
          Routing {routing.length} / {clients.length} computer{clients.length !== 1 ? 's' : ''}
        </span>
      </Section>

      {clients.length === 0 ? (
        <span className="muted" style={{ fontSize: 12, fontStyle: 'italic', padding: '0 12px' }}>No computers registered.</span>
      ) : (
        <table className="data-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Type</th>
              <th>ID</th>
              <th>Name</th>
              <th>Via</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(id => {
              const c = computers[id]
              return (
                <tr key={id} onClick={() => selectComputer(id)}>
                  <td className="muted">{TYPE_LABEL[c?.type ?? ''] ?? 'Unknown'}</td>
                  <td style={{ color: 'var(--cyan)', fontWeight: 600 }}>{id}</td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{c?.label}</td>
                  <td><Led kind={c?.via_modem ? 'on' : 'off'} title={c?.via_modem ? 'modem' : 'direct'} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <Section label="Terminal">
        <LuaTerminal computerId={computerId} />
      </Section>
    </div>
  )
}
