'use client'

import { useEffect } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import TurtlePanel from './turtles/TurtlePanel'
import MinecartPanel from './minecart/MinecartPanel'
import ModemPanel from './modem/ModemPanel'
import PlayerPanel from './player/PlayerPanel'
import StationaryPanel from './stationary/StationaryPanel'
import PollTimers from './PollTimers'
import { Led, Section } from '@/components/ui'

interface Props { computerId: number }

export default function ComputerPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const followComputer = useWorldViewStore(s => s.followComputer)

  useEffect(() => {
    followComputer(computerId)
  }, [computerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const viaModem = computer?.via_modem
  const wsOn = computer?.ws_connected

  const badge = viaModem
    ? 'badge-pill badge-pill-info'
    : wsOn
      ? 'badge-pill badge-pill-accent'
      : 'badge-pill'

  const badgeLabel = viaModem ? 'via Modem' : wsOn ? 'WebSocket' : 'HTTP'

  if (computer?.type === 'modem') {
    return (
      <div className="group">
        <Section label="Connection">
          <PollTimers computerId={computerId} />
        </Section>
        <ModemPanel computerId={computerId} />
      </div>
    )
  }

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
    </div>
  )
}
