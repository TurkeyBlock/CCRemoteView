'use client'

import type { EntitySighting } from '@/types/world'
import { Section } from '@/components/ui'

interface Props {
  entities?: EntitySighting[]
}

export default function EntityList({ entities }: Props) {
  if (!entities?.length) return null
  return (
    <Section label={`Entities (${entities.length})`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
        {entities.map(e => (
          <div key={e.id} className="row-between" style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>{e.name}</span>
            <span className="muted" style={{ fontSize: 11 }}>{e.x.toFixed(1)}, {e.y.toFixed(1)}, {e.z.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}
