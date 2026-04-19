'use client'

import { useEffect } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import TurtlePanel from './turtles/TurtlePanel'
import MinecartPanel from './minecart/MinecartPanel'
import ModemPanel from './modem/ModemPanel'
import PlayerPanel from './player/PlayerPanel'
import StationaryPanel from './stationary/StationaryPanel'

interface Props { computerId: number }

export default function ComputerPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const followComputer = useWorldViewStore(s => s.followComputer)

  useEffect(() => {
    followComputer(computerId)
  }, [computerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const viaModem = computer?.via_modem
  const badge = viaModem
    ? { label: '📡 via Modem', bg: 'rgba(80,140,200,0.2)', color: 'rgb(120,180,240)', border: '1px solid rgba(80,140,200,0.3)' }
    : { label: '⟳ Direct HTTP', bg: 'rgba(80,80,80,0.2)', color: 'gray', border: '1px solid rgba(80,80,80,0.3)' }

  if (computer?.type === 'modem') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ModemPanel computerId={computerId} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: '0.75em', padding: '2px 6px', borderRadius: 3, letterSpacing: '0.04em', alignSelf: 'flex-start', backgroundColor: badge.bg, color: badge.color, border: badge.border }}>
        {badge.label}
      </div>

      {computer?.type === 'minecart' && <MinecartPanel computerId={computerId} />}
      {computer?.type === 'player' && <PlayerPanel computerId={computerId} />}
      {computer?.type === 'stationary' && <StationaryPanel computerId={computerId} />}
      {(!computer?.type || !['minecart', 'player', 'stationary'].includes(computer.type)) && (
        <TurtlePanel computerId={computerId} />
      )}
    </div>
  )
}
