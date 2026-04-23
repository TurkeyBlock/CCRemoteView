'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import type { ItemStack } from '@/types/types'

interface Props {
  computerId: number
  invSlot?: ItemStack
  slotNum?: number
  isSelected: boolean
  onClick?: () => void
}

export default function InventorySlot({ computerId, invSlot, slotNum, isSelected, onClick }: Props) {
  const textureURL = useWorldStore(s => s.textureURL)
  const sendCommand = useWorldStore(s => s.sendCommand)
  const turtleLoc = useWorldStore(s => s.computers[computerId]?.loc)
  const selectedInventoryPos = useWorldViewStore(s => s.selectedInventoryPos)

  const isAdjacentToChest = !!(turtleLoc && selectedInventoryPos &&
    Math.abs(selectedInventoryPos.x - turtleLoc.x) +
    Math.abs(selectedInventoryPos.y - turtleLoc.y) +
    Math.abs(selectedInventoryPos.z - turtleLoc.z) === 1)

  const src = invSlot
    ? `${textureURL}items/${invSlot.name.replace(':', '/')}.png`
    : undefined

  function startDrag(e: React.DragEvent) {
    e.dataTransfer.dropEffect = 'move'
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('slotFrom', String(slotNum))
  }

  function onDrop(e: React.DragEvent) {
    const chestItemData = e.dataTransfer.getData('chestItem')
    if (chestItemData) {
      if (!isAdjacentToChest) return
      const { itemName, side } = JSON.parse(chestItemData)
      sendCommand(computerId, `tapi.suckItem(${JSON.stringify(itemName)}, ${JSON.stringify(side)}, ${e.ctrlKey ? 1 : 64})`)
      return
    }
    const slotFrom = e.dataTransfer.getData('slotFrom')
    sendCommand(
      computerId,
      `local oldSelected = turtle.getSelectedSlot();
      tapi.select(${slotFrom});
      turtle.transferTo(${slotNum}, ${e.ctrlKey ? 64 : 1});
      tapi.select(oldSelected);
      tapi.send_status_update();`
    )
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
      {src && (
        <img
          style={{ width: '80%', imageRendering: 'pixelated' }}
          src={src}
          alt={invSlot?.name ?? ''}
          onError={e => { (e.target as HTMLImageElement).src = '/favicon-32x32.png' }}
        />
      )}
      {invSlot && (
        <div className="inv-slot-count">{invSlot.count}</div>
      )}
    </div>
  )
}
