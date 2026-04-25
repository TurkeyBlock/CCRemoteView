'use client'

import { useEffect, useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import TurtlePanel from './turtles/TurtlePanel'
import MinecartPanel from './minecart/MinecartPanel'
import PlayerPanel from './player/PlayerPanel'
import StationaryPanel from './stationary/StationaryPanel'
import PollTimers from './PollTimers'
import { Led, Section } from '@/components/ui'

interface Props { computerId: number }

export default function ComputerPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const followComputer = useWorldViewStore(s => s.followComputer)
  const [showDebug, setShowDebug] = useState(false)

  useEffect(() => {
    followComputer(computerId)
  }, [computerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const wsOn = computer?.ws_connected
  const badge = wsOn ? 'badge-pill badge-pill-accent' : 'badge-pill'
  const badgeLabel = wsOn ? 'WebSocket' : 'HTTP'

  return (
    <div className="group">
      <div className="row-between">
        <span className={badge}>{badgeLabel}</span>
        {computer?.loc && (
          <span className="coord">
            <span><span className="coord-ax">X</span>{computer.loc.x}</span>
            <span><span className="coord-ax">Y</span>{computer.loc.y}</span>
            <span><span className="coord-ax">Z</span>{computer.loc.z}</span>
          </span>
        )}
      </div>

      <Section label="Connection">
        <PollTimers computerId={computerId} />
      </Section>

      {computer?.type === 'minecart' && <MinecartPanel computerId={computerId} />}
      {computer?.type === 'player' && <PlayerPanel computerId={computerId} />}
      {computer?.type === 'stationary' && <StationaryPanel computerId={computerId} />}
      {(!computer?.type || !['minecart', 'player', 'stationary'].includes(computer.type)) && (
        <TurtlePanel computerId={computerId} />
      )}

      <Section label="Debug">
        <button
          className="btn btn-compact btn-block"
          onClick={() => setShowDebug(d => !d)}
          style={{ fontSize: 11 }}
        >
          {showDebug ? 'Hide' : 'Show'} raw state
        </button>
        {showDebug && (
          <pre style={{
            marginTop: 6, padding: 8, fontSize: 10, lineHeight: 1.5,
            background: 'var(--ink)', border: 'var(--border)', borderRadius: 2,
            color: 'var(--fg)', overflowX: 'auto', overflowY: 'auto',
            maxHeight: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {JSON.stringify(computer, null, 2)}
          </pre>
        )}
      </Section>
    </div>
  )
}
