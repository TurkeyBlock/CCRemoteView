'use client'

import { useShallow } from 'zustand/react/shallow'
import { useWorldStore } from '@/store/useWorld'
import InventorySlot from '../../inventory/InventorySlot'

interface Props { computerId: number }

export default function TurtleInventory({ computerId }: Props) {
  const { inv, selectedSlot } = useWorldStore(
    useShallow(s => ({ inv: s.computers[computerId]?.inv, selectedSlot: s.computers[computerId]?.selectedSlot }))
  )
  const invokeCommand = useWorldStore(s => s.invokeCommand)
  if (!inv) return null

  return (
    <div className="inv-grid">
      {inv.map((slot, index) => (
        <InventorySlot
          key={index + 1}
          computerId={computerId}
          invSlot={slot ?? undefined}
          slotNum={index + 1}
          isSelected={index === (selectedSlot ?? 0) - 1}
          onClick={() => invokeCommand(computerId, 'select', [index + 1])}
        />
      ))}
    </div>
  )
}
