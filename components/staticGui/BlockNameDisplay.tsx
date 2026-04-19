'use client'

import { useWorldViewStore } from '@/store/useWorldView'

export default function BlockNameDisplay() {
  const hoveredBlock = useWorldViewStore(s => s.hoveredBlock)
  const hoveredBlockPos = useWorldViewStore(s => s.hoveredBlockPos)
  const hoveredEntity = useWorldViewStore(s => s.hoveredEntity)
  const lockBlockInfo = useWorldViewStore(s => s.lockBlockInfo)

  return (
    <div style={{ position: 'fixed', top: 10, right: 10, background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h2 style={{ ...h2Style, color: 'gray', fontSize: '0.75em', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {hoveredEntity ? 'Entity' : lockBlockInfo ? 'Last clicked block' : 'Hovered block'}
      </h2>
      {hoveredEntity ? (
        <>
          <h2 style={h2Style}>{hoveredEntity.name}</h2>
          <h2 style={h2Style}>{hoveredEntity.id}</h2>
          {hoveredEntity.worldPos && (
            <h2 style={h2Style}>
              {hoveredEntity.worldPos.x.toFixed(1)}, {hoveredEntity.worldPos.y.toFixed(1)}, {hoveredEntity.worldPos.z.toFixed(1)}
            </h2>
          )}
        </>
      ) : (
        <>
          {hoveredBlock && <h2 style={h2Style}>{hoveredBlock.name}:{hoveredBlock.metadata}</h2>}
          {hoveredBlockPos && <h2 style={h2Style}>{hoveredBlockPos.x}, {hoveredBlockPos.y}, {hoveredBlockPos.z}</h2>}
        </>
      )}
    </div>
  )
}

const h2Style: React.CSSProperties = { color: 'lightgray', userSelect: 'none', whiteSpace: 'nowrap', margin: 0, fontSize: '1em', fontWeight: 'normal' }
