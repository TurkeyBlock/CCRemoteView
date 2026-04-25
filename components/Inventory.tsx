'use client'

import { useWorldStore, worldBlocks } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
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
  const block = blockPos ? worldBlocks[`${blockPos.x},${blockPos.y},${blockPos.z}`] : null

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

  const blockName = block?.name
    ? block.name.split(':').pop()!.replace(/_/g, ' ')
    : 'Inventory'

  const itemCount = Object.values(normalized).reduce((sum, s) => sum + (s?.count ?? 0), 0)

  return (
    <div className="inv-chest-panel">
      <div className="inv-chest-header">
        <span className="inv-chest-header-name">{blockName}</span>
        <span className="inv-chest-header-slots">{inventorySize} slots · {itemCount} items</span>
        <button
          className="btn btn-compact"
          onClick={() => useWorldViewStore.setState({ selectedInventoryPos: null })}
          style={{ padding: '1px 7px', fontSize: 14, lineHeight: 1 }}
        >×</button>
      </div>
      <div className="inv-chest-body">
        <div className="inv-grid inv-grid-wide">
          {Array.from({ length: inventorySize }, (_, i) => i + 1).map(slotIdx => (
            <GenericInventorySlot
              key={`${slotIdx}`}
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
    </div>
  )
}
