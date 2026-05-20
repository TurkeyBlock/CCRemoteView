'use client'

import { FS } from '@/utils/fontSize'
// Panel shown when a neural-interface player computer is selected.
// Displays player stats, armor, hotbar, full inventory, ender chest, nearby entities,
// a Lua terminal, action buttons, and the GlassesEditor trigger.
import { memo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorldStore } from '@/store/useWorld'
import LuaTerminal from '../LuaTerminal'
import ActionButtons from '../ActionButtons'
import EntityList from '../EntityList'
import { Section } from '@/components/ui'
import GenericInventorySlot from '@/components/inventory/GenericInventorySlot'
import GlassesEditor from './GlassesEditor'
import type { ItemStack } from '@/types/world'
import { normalizeInventory } from '@/utils/inventory'

const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const
const PLAYER_INV_SIZE = 36
const ENDER_CHEST_SIZE = 27

interface Props { computerId: number }

export default memo(function PlayerPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const invokeCommand = useWorldStore(s => s.invokeCommand)

  const { inventory, equipment, enderChest, playerName } = useWorldStore(
    useShallow(s => ({
      inventory:  (s.computers[computerId] as any)?.inventory,
      equipment:  (s.computers[computerId] as any)?.equipment,
      enderChest: (s.computers[computerId] as any)?.enderChest,
      playerName: (s.computers[computerId] as any)?.playerName,
    }))
  )

  const [showEnder, setShowEnder] = useState(false)

  if (!computer) return null

  const hasScanner = computer.peripherals?.includes('plethora:scanner')
  const eq = equipment as Record<string, ItemStack> | undefined
  const invNorm    = normalizeInventory<ItemStack>(inventory)
  const enderNorm  = normalizeInventory<ItemStack>(enderChest)

  const invItemCount = Object.values(invNorm).reduce((s, it) => s + (it?.count ?? 0), 0)

  function handleOpenEnder() {
    invokeCommand(computerId, 'getEnder')
    setShowEnder(true)
  }

  return (
    <div className="group">
      <ActionButtons computerId={computerId} hasScanner={hasScanner} hasRideAlong />

      <Section label={playerName ? `Armor · ${playerName}` : 'Armor'}>
        <div className="player-armor-row">
          {ARMOR_SLOTS.map(slot => (
            <div key={slot} className="player-armor-slot">
              <GenericInventorySlot invSlot={eq?.[slot] ?? undefined} />
              <span className="player-armor-label">{slot}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        label="Inventory"
        right={
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {inventory && <span style={{ fontSize: FS['11'], color: 'var(--fg-mute)' }}>{invItemCount} items</span>}
            <button className="btn btn-compact" onClick={() => invokeCommand(computerId, 'getInventory')}>
              Refresh
            </button>
          </span>
        }
      >
        <div className="inv-grid inv-grid-wide">
          {Array.from({ length: PLAYER_INV_SIZE }, (_, i) => (
            <GenericInventorySlot key={i + 1} invSlot={invNorm[i + 1]} slotNum={i + 1} />
          ))}
        </div>
      </Section>

      <Section
        label="Ender Chest"
        right={
          <span style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-compact" onClick={handleOpenEnder}>
              {showEnder ? 'Refresh' : 'Open'}
            </button>
            {showEnder && (
              <button className="btn btn-compact" onClick={() => setShowEnder(false)}>×</button>
            )}
          </span>
        }
      >
        {showEnder && enderChest && (
          <div className="inv-grid inv-grid-wide">
            {Array.from({ length: ENDER_CHEST_SIZE }, (_, i) => (
              <GenericInventorySlot key={i + 1} invSlot={enderNorm[i + 1]} slotNum={i + 1} />
            ))}
          </div>
        )}
        {showEnder && !enderChest && (
          <div style={{ fontSize: FS['11'], color: 'var(--fg-mute)', padding: '4px 0' }}>Fetching…</div>
        )}
      </Section>

      <EntityList entities={computer.entities} />

      <Section label="Glasses Canvas">
        <GlassesEditor computerId={computerId} />
      </Section>

      <Section label="Terminal">
        <LuaTerminal computerId={computerId} />
      </Section>
    </div>
  )
})
