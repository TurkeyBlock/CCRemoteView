'use client'

import { useWorldViewStore } from '@/store/useWorldView'

export default function BlockNameDisplay() {
  const hoveredBlock    = useWorldViewStore(s => s.hoveredBlock)
  const hoveredBlockPos = useWorldViewStore(s => s.hoveredBlockPos)
  const hoveredEntity   = useWorldViewStore(s => s.hoveredEntity)
  const lockBlockInfo   = useWorldViewStore(s => s.lockBlockInfo)

  const hasContent = hoveredEntity || hoveredBlock || hoveredBlockPos
  if (!hasContent) return null

  return (
    <div className="canvas-overlay" style={{ top: 12, right: 12 }}>
      <div className="overlay-title">
        {hoveredEntity ? 'Entity' : lockBlockInfo ? 'Last clicked block' : 'Hovered block'}
      </div>
      <div className="overlay-body">
        {hoveredEntity ? (
          <>
            <div className="overlay-value">{hoveredEntity.name}</div>
            <div className="overlay-value muted" style={{ fontSize: 11 }}>{hoveredEntity.id}</div>
            {hoveredEntity.worldPos && (
              <div className="overlay-value muted" style={{ marginTop: 2 }}>
                {hoveredEntity.worldPos.x.toFixed(1)}, {hoveredEntity.worldPos.y.toFixed(1)}, {hoveredEntity.worldPos.z.toFixed(1)}
              </div>
            )}
          </>
        ) : (
          <>
            {hoveredBlock && <div className="overlay-value">{hoveredBlock.name}:{hoveredBlock.metadata}</div>}
            {hoveredBlockPos && (
              <div className="overlay-value muted" style={{ marginTop: 2 }}>
                {hoveredBlockPos.x}, {hoveredBlockPos.y}, {hoveredBlockPos.z}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
