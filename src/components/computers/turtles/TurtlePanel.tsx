'use client'

import { memo, useRef, useState, useEffect } from 'react'
import ConfirmDialog from '@/components/modals/ConfirmDialog'
import { useComputerPanel } from '../useComputerPanel'
import TurtleInventory from './TurtleInventory'
import FuelGauge from './FuelGauge'
import MovementControl from './MovementControl'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'
import { useWorldStore } from '@/store/useWorld'

interface Props { computerId: number }

export default memo(function TurtlePanel({ computerId }: Props) {
  const { focusOnComputer, followComputer, sendStopSignal, isFollowing } = useComputerPanel(computerId)
  const computer = useWorldStore(s => s.computers[computerId])
  const invokeCommand = useWorldStore(s => s.invokeCommand)
  const commandResult = useWorldStore(s => s.commandResult[computerId])

  const [inspectResult, setInspectResult] = useState<unknown>(null)
  const [stopOpen, setStopOpen] = useState(false)
  const inspectPendingRef = useRef(false)

  // Capture the next commandResult that arrives after the Inspect button is clicked
  useEffect(() => {
    if (inspectPendingRef.current && commandResult !== undefined) {
      inspectPendingRef.current = false
      setInspectResult(commandResult)
    }
  }, [commandResult])

  function handleInspect() {
    inspectPendingRef.current = true
    setInspectResult(null)
    invokeCommand(computerId, 'inspectSelectedItem')
  }

  return (
    <>
      {(computer as any)?.inv && (
        <Section
          label="Inventory"
          right={
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>16 slots</span>
              <button className="btn btn-compact" onClick={handleInspect}>Inspect</button>
            </span>
          }
        >
          <TurtleInventory computerId={computerId} />
          {inspectResult != null && (
            <div className="code-pad-result" style={{ marginTop: 6 }}>
              {typeof inspectResult === 'object'
                ? JSON.stringify(inspectResult, null, 2)
                : String(inspectResult)}
            </div>
          )}
        </Section>
      )}

      <Section label="Fuel" right={computer ? `${(computer as any).fuelLevel ?? 0} / ${(computer as any).fuelLimit ?? 0}` : undefined}>
        <FuelGauge computerId={computerId} />
      </Section>

      <Section label="Movement">
        <MovementControl computerId={computerId} />
      </Section>

      <Section label="Camera">
        <div className="btn-row-2">
          <button
            className={`btn${isFollowing ? ' btn-toggled' : ''}`}
            onClick={() => followComputer(computerId)}
            title="Keep camera following this turtle"
          >
            {isFollowing ? '● Following' : 'Toggle Follow'}
          </button>
          <button className="btn" onClick={() => focusOnComputer(computerId)} title="Point camera at this turtle">
            Focus Camera
          </button>
        </div>
        <button
          className="btn btn-danger btn-block"
          onClick={() => setStopOpen(true)}
        >
          ● Stop ●
        </button>
        <ConfirmDialog
          open={stopOpen}
          title="Stop turtle"
          message="In-progress actions will be interrupted."
          confirmLabel="Stop"
          confirmDanger
          onConfirm={() => { setStopOpen(false); sendStopSignal(computerId) }}
          onCancel={() => setStopOpen(false)}
        />
      </Section>

      <Section label="Lua · Remote Execute">
        <LuaTerminal computerId={computerId} />
      </Section>
    </>
  )
})
