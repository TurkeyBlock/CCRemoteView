'use client'

import { useComputerPanel } from '../useComputerPanel'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'
import ActionButtons from '../ActionButtons'
import EntityList from '../EntityList'

interface Props { computerId: number }

export default function PlayerPanel({ computerId }: Props) {
  const { computer } = useComputerPanel(computerId)

  if (!computer) return null

  const hasScanner = computer.peripherals?.includes('plethora:scanner')

  return (
    <div className="group">
      <ActionButtons computerId={computerId} hasScanner={hasScanner} />
      <EntityList entities={computer.entities} />
      <Section label="Terminal">
        <LuaTerminal computerId={computerId} />
      </Section>
    </div>
  )
}
