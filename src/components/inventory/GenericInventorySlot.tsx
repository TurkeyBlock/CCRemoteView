'use client'

import { useEffect } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore, getBlockIconInfo, getItemIconInfo } from '@/store/useWorldView'
import type { ItemStack } from '@/types/world'
import BlockIcon from './BlockIcon'

interface Props {
  invSlot?: ItemStack
  slotNum?: number
  computerId?: number
  side?: string
  isAdjacent?: boolean
  invokeCommand?: (computerId: number, command: string, args?: (string | number | boolean | null | undefined)[]) => void
}

export default function GenericInventorySlot({ invSlot, slotNum, computerId, side, isAdjacent, invokeCommand }: Props) {
  const assetURL = useWorldStore(s => s.assetURL)
  const blockMapsLoaded = useWorldViewStore(s => s.blockMapsLoaded)
  const loadBlockMaps = useWorldViewStore(s => s.loadBlockMaps)

  useEffect(() => { loadBlockMaps() }, [loadBlockMaps])

  const blockInfo = invSlot && blockMapsLoaded
    ? getBlockIconInfo(assetURL, invSlot.name, invSlot.damage ?? 0)
    : null
  const itemInfo = invSlot && blockMapsLoaded && !blockInfo
    ? getItemIconInfo(assetURL, invSlot.name, invSlot.damage ?? 0)
    : null

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
      {invSlot && (
        blockInfo
          ? <BlockIcon src={blockInfo.url} uv={blockInfo.uv} />
          : !blockMapsLoaded
            ? <span style={{ fontSize: '9px', color: 'var(--fg-mute)', textAlign: 'center', wordBreak: 'break-all', padding: '2px', lineHeight: 1.1 }}>
                {invSlot.name.includes(':') ? invSlot.name.split(':')[1] : invSlot.name}
              </span>
            : <img
                style={{ width: '80%', imageRendering: 'pixelated' }}
                src={itemInfo?.url ?? `${assetURL}items/${invSlot.name.replace(':', '/')}.png`}
                alt={invSlot.name}
                onError={e => { (e.target as HTMLImageElement).src = '/favicon-32x32.png' }}
              />
      )}
      {invSlot && (
        <div className="inv-slot-count">{invSlot.count}</div>
      )}
    </div>
  )
}
