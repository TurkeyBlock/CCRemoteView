'use client'

import { useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'

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
    <div className="group">
      <Section label="Propulsion">
        <div className="btn-row-3">
          <input
            type="number" min={-2} max={2}
            value={propelPower}
            onChange={e => setPropelPower(Number(e.target.value))}
            className="input"
            style={{ textAlign: 'center', padding: '4px' }}
          />
          <button
            className={`btn btn-compact${hasKinetic ? '' : ' btn-disabled'}`}
            onClick={() => sendCommand(computerId, `return capi.propel(${propelPower})`)}
          >Propel</button>
          <button
            className={`btn btn-compact${hasKinetic ? (loopPropelActive ? ' btn-toggled' : '') : ' btn-disabled'}`}
            onClick={toggleLoopPropel}
          >Loop: {loopPropelActive ? 'ON' : 'OFF'}</button>
        </div>
      </Section>

      <Section label="Actions">
        <div className="btn-row-2">
          <button
            className={`btn btn-compact${hasScanner ? '' : ' btn-disabled'}`}
            onClick={() => loopPropelActive ? sendSideCommand(computerId, 'return capi.scan()') : sendCommand(computerId, 'return capi.scan()')}
          >Block Scan</button>
          <button
            className={`btn btn-compact${hasSensor ? '' : ' btn-disabled'}`}
            onClick={() => loopPropelActive ? sendSideCommand(computerId, 'return capi.sense()') : sendCommand(computerId, 'return capi.sense()')}
          >Entity Scan</button>
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

      {computer.chatLog && computer.chatLog.length > 0 && (
        <Section label="Chat Log">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
            {[...computer.chatLog].reverse().slice(0, 20).map((msg, i) => (
              <div key={i} className="row-between" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>{msg.player}:</span>
                <span className="muted" style={{ flex: 1 }}>{msg.message}</span>
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
