'use client'

import { useState } from 'react'
import { useComputerPanel } from '../useComputerPanel'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'
import ActionButtons from '../ActionButtons'
import EntityList from '../EntityList'

interface Props { computerId: number }

export default function MinecartPanel({ computerId }: Props) {
  const { computer, invokeCommand, sendStopSignal } = useComputerPanel(computerId)
  const [propelPower, setPropelPower] = useState(1)
  const [loopPropelActive, setLoopPropelActive] = useState(false)

  if (!computer) return null

  const hasKinetic = computer.peripherals?.includes('plethora:kinetic')
  const hasScanner = computer.peripherals?.includes('plethora:scanner')
  const hasSensor  = computer.peripherals?.includes('plethora:sensor')

  function toggleLoopPropel() {
    if (loopPropelActive) {
      sendStopSignal(computerId)
      setLoopPropelActive(false)
    } else {
      invokeCommand(computerId, 'propel_loop', [propelPower])
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
            onClick={() => invokeCommand(computerId, 'propel', [propelPower])}
          >Propel</button>
          <button
            className={`btn btn-compact${hasKinetic ? (loopPropelActive ? ' btn-toggled' : '') : ' btn-disabled'}`}
            onClick={toggleLoopPropel}
          >Loop: {loopPropelActive ? 'ON' : 'OFF'}</button>
        </div>
      </Section>

      <ActionButtons computerId={computerId} hasScanner={hasScanner} hasSensor={hasSensor} />
      <EntityList entities={computer.entities} />

      <Section label="Terminal">
        <LuaTerminal computerId={computerId} />
      </Section>
    </div>
  )
}
