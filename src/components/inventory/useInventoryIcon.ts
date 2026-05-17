'use client'

import { useEffect } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useRenderFiltersStore, useTexturesStore, getBlockIconInfo, getItemIconInfo } from '@/store/useWorldView'
import type { ItemStack } from '@/types/world'

export interface InventoryIconData {
  assetURL: string
  blockMapsLoaded: boolean
  blockInfo: ReturnType<typeof getBlockIconInfo> | null
  itemInfo: ReturnType<typeof getItemIconInfo> | null
}

/**
 * Shared logic for inventory slot icon rendering: loads block maps,
 * resolves block/item icon info for the given item stack.
 */
export function useInventoryIcon(invSlot: ItemStack | undefined): InventoryIconData {
  const assetURL = useWorldStore(s => s.assetURL)
  const blockMapsLoaded = useRenderFiltersStore(s => s.blockMapsLoaded)
  const loadBlockMaps = useTexturesStore(s => s.loadBlockMaps)

  useEffect(() => { loadBlockMaps() }, [loadBlockMaps])

  const blockInfo = invSlot && blockMapsLoaded
    ? getBlockIconInfo(assetURL, invSlot.name, invSlot.damage ?? 0)
    : null
  const itemInfo = invSlot && blockMapsLoaded && !blockInfo
    ? getItemIconInfo(assetURL, invSlot.name, invSlot.damage ?? 0)
    : null

  return { assetURL, blockMapsLoaded, blockInfo, itemInfo }
}
