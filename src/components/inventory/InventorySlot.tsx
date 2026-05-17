'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import type { ItemStack } from '@/types/world'
import InventorySlotIcon from './InventorySlotIcon'
import { useInventoryIcon } from './useInventoryIcon'

interface Props {
  computerId: number
  invSlot?: ItemStack
  slotNum?: number
  isSelected: boolean
  onClick?: () => void
}

export default function InventorySlot({ computerId, invSlot, slotNum, isSelected, onClick }: Props) {
  const invokeCommand = useWorldStore(s => s.invokeCommand)
  const turtleLoc = useWorldStore(s => s.computers[computerId]?.loc)
  const selectedInventoryPos = useWorldViewStore(s => s.selectedInventoryPos)
  const icon = useInventoryIcon(invSlot)

  const isAdjacentToChest = !!(turtleLoc && selectedInventoryPos &&
    Math.abs(selectedInventoryPos.x - turtleLoc.x) +
    Math.abs(selectedInventoryPos.y - turtleLoc.y) +
    Math.abs(selectedInventoryPos.z - turtleLoc.z) === 1)

  function startDrag(e: React.DragEvent) {
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('slotFrom', String(slotNum))
  }

  function onDrop(e: React.DragEvent) {
    const chestItemData = e.dataTransfer.getData('chestItem')
    if (chestItemData) {
      if (!isAdjacentToChest) return
      let parsed: { itemName?: string; side?: string }
      try { parsed = JSON.parse(chestItemData) } catch { return }
      const { itemName, side } = parsed
      invokeCommand(computerId, 'suckItem', [itemName, side, e.ctrlKey ? 1 : 64])
      return
    }
    const slotFrom = e.dataTransfer.getData('slotFrom')
    if (!slotFrom) return
    invokeCommand(computerId, 'transferSlot', [parseInt(slotFrom, 10), slotNum, e.ctrlKey ? 64 : 1])
  }

  return (
    <div
      draggable
      onDragStart={startDrag}
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      onDragEnter={e => e.preventDefault()}
      onClick={onClick}
      title={invSlot?.name ?? ''}
      className={`inv-slot${isSelected ? ' inv-slot-selected' : ''}`}
    >
      {invSlot && <InventorySlotIcon invSlot={invSlot} icon={icon} />}
    </div>
  )
}
