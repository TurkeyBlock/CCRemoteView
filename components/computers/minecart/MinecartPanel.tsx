'use client'

import { useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'
import ComputerLocation from '../ComputerLocation'
import ButtonGrid from '../ButtonGrid'
import ScrollList from '../ScrollList'
import { btn, activeBtn, missingBtn, colors, inputStyle } from '../computerStyles'

interface Props { computerId: number }

export default function MinecartPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const sendCommand = useWorldStore(s => s.sendCommand)
  const sendSideCommand = useWorldStore(s => s.sendSideCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)
  const focusOnComputer = useWorldViewStore(s => s.focusOnComputer)
  const followComputer = useWorldViewStore(s => s.followComputer)
  const followedComputer = useWorldViewStore(s => s.followedComputer)
  const [propelPower, setPropelPower] = useState(1)
  const [loopPropelActive, setLoopPropelActive] = useState(false)

  if (!computer) return null

  const hasKinetic = computer.peripherals?.includes('plethora:kinetic')
  const hasScanner = computer.peripherals?.includes('plethora:scanner')
  const hasSensor = computer.peripherals?.includes('plethora:sensor')
  const isFollowing = followedComputer.computerId === computerId

  function toggleLoopPropel() {
    if (loopPropelActive) {
      sendStopSignal(computerId)
      setLoopPropelActive(false)
    } else {
      sendCommand(computerId, `return capi.propel_loop(${propelPower})`)
      setLoopPropelActive(true)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ComputerLocation loc={computer.loc} />
      <ButtonGrid columns={3}>
        <input
          type="number" min={-2} max={2}
          value={propelPower}
          onChange={e => setPropelPower(Number(e.target.value))}
          style={{ ...inputStyle, padding: '8px 4px', textAlign: 'center' }}
        />
        <button style={hasKinetic ? btn : missingBtn} onClick={() => sendCommand(computerId, `return capi.propel(${propelPower})`)}>Propel</button>
        <button style={hasKinetic ? (loopPropelActive ? activeBtn : btn) : missingBtn} onClick={toggleLoopPropel}>
          Loop Propel: {loopPropelActive ? 'ON' : 'OFF'}
        </button>
        <button style={hasScanner ? btn : missingBtn} onClick={() => loopPropelActive ? sendSideCommand(computerId, 'return capi.scan()') : sendCommand(computerId, 'return capi.scan()')}>Block Scan</button>
        <button style={hasSensor ? btn : missingBtn} onClick={() => loopPropelActive ? sendSideCommand(computerId, 'return capi.sense()') : sendCommand(computerId, 'return capi.sense()')}>Entity Scan</button>
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

      {computer.chatLog && computer.chatLog.length > 0 && (
        <ScrollList label="Chat Log">
          {[...computer.chatLog].reverse().slice(0, 20).map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: colors.text, gap: 8 }}>
              <span style={{ color: colors.textName, whiteSpace: 'nowrap' }}>{msg.player}:</span>
              <span style={{ color: colors.textLight, flex: 1 }}>{msg.message}</span>
            </div>
          ))}
        </ScrollList>
      )}

      <LuaTerminal computerId={computerId} />
    </div>
  )
}
