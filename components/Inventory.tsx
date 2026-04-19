'use client'

import { useWorldStore } from '@/store/useWorld'
import type { Inventory } from '@/types/types'
import GenericInventorySlot from './GenericInventorySlot'

interface Props {
  inventory: Inventory
  inventorySize: number
  computerId: number
  blockPos: { x: number; y: number; z: number } | null
}

export default function InventoryView({ inventory, inventorySize, computerId, blockPos }: Props) {
  const sendCommand = useWorldStore(s => s.sendCommand)
  const computers = useWorldStore(s => s.computers)

  const normalized: Record<number, { name: string; count: number }> = {}
  if (inventory) {
    if (Array.isArray(inventory)) {
      for (let i = 0; i < (inventory as any[]).length; i++) {
        if ((inventory as any[])[i] != null) normalized[i + 1] = (inventory as any[])[i]
      }
    } else {
      Object.assign(normalized, inventory)
    }
  }

  const turtleLoc = computers[computerId]?.loc
  let side: string | undefined
  let isAdjacent = false
  if (blockPos && turtleLoc) {
    const dx = Math.abs(blockPos.x - turtleLoc.x)
    const dy = blockPos.y - turtleLoc.y
    const dz = Math.abs(blockPos.z - turtleLoc.z)
    isAdjacent = dx + Math.abs(dy) + dz === 1
    side = dy > 0 ? 'top' : dy < 0 ? 'bottom' : 'front'
  }

  return (
    <div style={{ backgroundColor: 'lightgray' }}>
      <div style={{
        width: 576,
        display: 'grid',
        gridTemplateColumns: 'repeat(9, 1fr)',
        backgroundColor: 'lightgray',
      }}>
        {Array.from({ length: inventorySize }, (_, i) => i + 1).map(slotIdx => (
          <GenericInventorySlot
            key={`${normalized[slotIdx]?.name ?? ''}${normalized[slotIdx]?.count ?? ''}-${slotIdx}`}
            invSlot={normalized[slotIdx]}
            slotNum={slotIdx}
            computerId={computerId}
            side={side}
            isAdjacent={isAdjacent}
            sendCommand={sendCommand}
          />
        ))}
      </div>
    </div>
  )
}
