'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'
import ComputerLocation from '../ComputerLocation'
import ButtonGrid from '../ButtonGrid'
import ScrollList from '../ScrollList'
import { btn, activeBtn, missingBtn, colors } from '../computerStyles'

interface Props { computerId: number }

export default function PlayerPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const sendCommand = useWorldStore(s => s.sendCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)
  const focusOnComputer = useWorldViewStore(s => s.focusOnComputer)
  const followComputer = useWorldViewStore(s => s.followComputer)
  const followedComputer = useWorldViewStore(s => s.followedComputer)

  if (!computer) return null

  const hasScanner = computer.peripherals?.includes('plethora:scanner')
  const isFollowing = followedComputer.computerId === computerId

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ComputerLocation loc={computer.loc ?? null} showUnavailable />
      <ButtonGrid>
        <button style={hasScanner ? btn : missingBtn} onClick={() => sendCommand(computerId, 'return papi.scan()')}>Block Scan</button>
        <button style={btn} onClick={() => focusOnComputer(computerId)}>Focus Camera</button>
        <button style={isFollowing ? activeBtn : btn} onClick={() => followComputer(computerId)}>Toggle Follow</button>
        <button style={btn} onClick={() => sendStopSignal(computerId)}>🛑 Stop 🛑</button>
      </ButtonGrid>

      {computer.entities && computer.entities.length > 0 && (
        <ScrollList label="Nearby Entities" count={computer.entities.length}>
          {computer.entities.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: colors.text, gap: 8 }}>
              <span style={{ color: colors.textName, whiteSpace: 'nowrap' }}>{e.name}</span>
              <span style={{ color: 'gray', fontSize: '0.9em' }}>{e.x.toFixed(1)}, {e.y.toFixed(1)}, {e.z.toFixed(1)}</span>
            </div>
          ))}
        </ScrollList>
      )}

      <LuaTerminal computerId={computerId} />
    </div>
  )
}
