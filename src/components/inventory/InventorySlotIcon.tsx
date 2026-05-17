'use client'

import type { ItemStack } from '@/types/world'
import BlockIcon from './BlockIcon'
import type { InventoryIconData } from './useInventoryIcon'

interface Props {
  invSlot: ItemStack
  icon: InventoryIconData
}

/**
 * Renders the icon-with-count visual for an inventory slot.
 * Falls back through: BlockIcon -> text label (if maps not loaded) -> item PNG -> favicon.
 */
export default function InventorySlotIcon({ invSlot, icon }: Props) {
  const { assetURL, blockMapsLoaded, blockInfo, itemInfo } = icon
  return (
    <>
      {blockInfo
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
      }
      <div className="inv-slot-count">{invSlot.count}</div>
    </>
  )
}
