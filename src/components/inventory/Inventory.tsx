'use client'

import { useWorldStore, lookupBlock } from '@/store/useWorld'
import { FS } from '@/utils/fontSize'
import { useWorldViewStore } from '@/store/useWorldView'
import type { Inventory } from '@/types/world'
import { normalizeInventory } from '@/utils/inventory'
import GenericInventorySlot from './GenericInventorySlot'

interface Props {
  inventory: Inventory
  inventorySize: number
  computerId: number
  blockPos: { x: number; y: number; z: number } | null
}

function getSide(dy: number): string {
  if (dy > 0) return 'top';
  if (dy < 0) return 'bottom';
  return 'front';
}

export default function InventoryView({ inventory, inventorySize, computerId, blockPos }: Props) {
  const invokeCommand = useWorldStore(s => s.invokeCommand)
  const computers = useWorldStore(s => s.computers)
  const block = blockPos ? lookupBlock(`${blockPos.x},${blockPos.y},${blockPos.z}`) : null

  const normalized = normalizeInventory<{ name: string; count: number }>(inventory)

  const turtleLoc = computers[computerId]?.loc
  let side: string | undefined
  let isAdjacent = false
  if (blockPos && turtleLoc) {
    const dx = Math.abs(blockPos.x - turtleLoc.x)
    const dy = blockPos.y - turtleLoc.y
    const dz = Math.abs(blockPos.z - turtleLoc.z)
    isAdjacent = dx + Math.abs(dy) + dz === 1
    side = getSide(dy)
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
          style={{ padding: '1px 7px', fontSize: FS['14'], lineHeight: 1 }}
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
              invokeCommand={invokeCommand}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
