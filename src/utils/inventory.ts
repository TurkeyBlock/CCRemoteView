import type { ItemStack } from '@/types/world'

/**
 * Normalize a raw inventory payload into a `Record<number, ItemStack>`.
 *
 * Accepts:
 *  - `null` / `undefined` / non-objects → returns `{}`
 *  - Arrays (Lua 1-indexed often arrives as 0-indexed JS arrays) → returns
 *    `{ [i+1]: item }` for entries that are neither `null`/`undefined` nor `false`.
 *    (Lua peripherals sometimes serialize empty slots as `false`.)
 *  - Plain objects (already keyed by slot) → returns a shallow copy.
 */
export function normalizeInventory<T = ItemStack>(raw: unknown): Record<number, T> {
  if (!raw || typeof raw !== 'object') return {}
  if (Array.isArray(raw)) {
    const out: Record<number, T> = {}
    for (let i = 0; i < raw.length; i++) {
      const v = raw[i]
      if (v != null && v !== false) out[i + 1] = v as T
    }
    return out
  }
  return { ...(raw as Record<number, T>) }
}
