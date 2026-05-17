/** Parses a transparency list into sets of name-only matches and "name:meta" specific matches. */
export function parseTransparencyList(list: Iterable<string>): {
  all: Set<string>
  specific: Set<string>
} {
  const all = new Set<string>()
  const specific = new Set<string>()
  for (const h of list) {
    const parts = h.split(':')
    if (parts.length > 2) {
      const last = parts[parts.length - 1]
      const n = parseInt(last, 10)
      if (!isNaN(n) && String(n) === last) {
        specific.add(`${parts.slice(0, -1).join(':')}:${n}`)
        continue
      }
    }
    all.add(h)
  }
  return { all, specific }
}
