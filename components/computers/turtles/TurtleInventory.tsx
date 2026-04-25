'use client'

import { useShallow } from 'zustand/react/shallow'
import { useWorldStore } from '@/store/useWorld'
import InventorySlot from '../../InventorySlot'

interface Props { computerId: number }

export default function TurtleInventory({ computerId }: Props) {
  const { inv, selectedSlot } = useWorldStore(
    useShallow(s => ({ inv: s.computers[computerId]?.inv, selectedSlot: s.computers[computerId]?.selectedSlot }))
  )
  const sendCommand = useWorldStore(s => s.sendCommand)
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
          onClick={() => sendCommand(computerId, `tapi.select(${index + 1})`)}
        />
      ))}
    </div>
  )
}
