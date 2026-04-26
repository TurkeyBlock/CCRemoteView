'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'

interface Props { computerId: number }

export default function PlayerPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const invokeCommand = useWorldStore(s => s.invokeCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)
  const focusOnComputer = useWorldViewStore(s => s.focusOnComputer)
  const followComputer = useWorldViewStore(s => s.followComputer)
  const followedComputer = useWorldViewStore(s => s.followedComputer)

  if (!computer) return null

  const hasScanner = computer.peripherals?.includes('plethora:scanner')
  const isFollowing = followedComputer.computerId === computerId

  return (
    <div className="group">
      <Section label="Actions">
        <div className="btn-row-2">
          <button
            className={`btn btn-compact${hasScanner ? '' : ' btn-disabled'}`}
            onClick={() => invokeCommand(computerId, 'scan')}
          >Block Scan</button>
          <button className="btn btn-compact" onClick={() => focusOnComputer(computerId)}>Focus</button>
          <button
            className={`btn btn-compact${isFollowing ? ' btn-toggled' : ''}`}
            onClick={() => followComputer(computerId)}
          >{isFollowing ? 'Unfollow' : 'Follow'}</button>
          <button className="btn btn-compact btn-danger" onClick={() => sendStopSignal(computerId)}>Stop</button>
        </div>
      </Section>

      {computer.entities && computer.entities.length > 0 && (
        <Section label={`Entities (${computer.entities.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
            {computer.entities.map(e => (
              <div key={e.id} className="row-between" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>{e.name}</span>
                <span className="muted" style={{ fontSize: 11 }}>{e.x.toFixed(1)}, {e.y.toFixed(1)}, {e.z.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section label="Terminal">
        <LuaTerminal computerId={computerId} />
      </Section>
    </div>
  )
}
