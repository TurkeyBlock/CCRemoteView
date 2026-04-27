'use client'

import { useComputerPanel } from '../useComputerPanel'
import TurtleInventory from './TurtleInventory'
import FuelGauge from './FuelGauge'
import MovementControl from './MovementControl'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'

interface Props { computerId: number }

export default function TurtlePanel({ computerId }: Props) {
  const { computer, focusOnComputer, followComputer, sendStopSignal, isFollowing } = useComputerPanel(computerId)

  return (
    <>
      {computer?.inv && (
        <Section label="Inventory" right="16 slots">
          <TurtleInventory computerId={computerId} />
        </Section>
      )}

      <Section label="Fuel" right={computer ? `${computer.fuelLevel ?? 0} / ${computer.fuelLimit ?? 0}` : undefined}>
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
          onClick={() => sendStopSignal(computerId)}
        >
          ● Stop ●
        </button>
      </Section>

      <Section label="Lua · Remote Execute">
        <LuaTerminal computerId={computerId} />
      </Section>
    </>
  )
}
