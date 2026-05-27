'use client'

import type { ItemStack } from '@/types/world'
import InventorySlotIcon from './InventorySlotIcon'
import { useInventoryIcon } from './useInventoryIcon'

interface Props {
  invSlot?: ItemStack
  slotNum?: number
  computerId?: number
  side?: string
  isAdjacent?: boolean
  invokeCommand?: (computerId: number, command: string, args?: (string | number | boolean | null | undefined)[]) => void
}

export default function GenericInventorySlot({ invSlot, slotNum, computerId, side, isAdjacent, invokeCommand }: Props) {
  const icon = useInventoryIcon(invSlot)

  function startDrag(e: React.DragEvent) {
    if (!invSlot || slotNum == null || !isAdjacent) return
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('chestItem', JSON.stringify({ itemName: invSlot.name, slotNum, side }))
  }

  function onDrop(e: React.DragEvent) {
    const slotFrom = e.dataTransfer.getData('slotFrom')
    if (!slotFrom || computerId == null || !side || !isAdjacent || !invokeCommand) return
    invokeCommand(computerId, 'dropToChest', [parseInt(slotFrom, 10), side, e.ctrlKey ? 1 : 64])
  }

  return (
    <div
      draggable
      onDragStart={startDrag}
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      onDragEnter={e => e.preventDefault()}
      className="inv-slot"
      title={invSlot?.name ?? ''}
    >
      {invSlot && <InventorySlotIcon invSlot={invSlot} icon={icon} />}
    </div>
  )
}
