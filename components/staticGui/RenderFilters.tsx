'use client'

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useWorldViewStore } from '@/store/useWorldView'
import { useUserStore } from '@/store/useUser'
import { useWorldStore } from '@/store/useWorld'
import { HeaderMenu, Checkbox } from '@/components/ui'

interface Props { onOpened?: () => void }
export interface PanelHandle { setOpen: (v: boolean) => void }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const RenderFilters = forwardRef<PanelHandle, Props>(function RenderFilters({ onOpened }, ref) {
  const [open, setOpen] = useState(false)
  useImperativeHandle(ref, () => ({ setOpen }), [])
  const [yMinLocal, setYMinLocal] = useState(0)
  const [yMaxLocal, setYMaxLocal] = useState(255)
  const [xzRangeLocal, setXzRangeLocal] = useState<number | null>(null)
  const [renderDistLocal, setRenderDistLocal] = useState(12)

  const worldView = useWorldViewStore()
  const savedFileSizeBytes = useUserStore(s => s.savedFileSizeBytes)
  const computers = useWorldStore(s => s.computers)
  const selectedComputerId = useWorldViewStore(s => s.selectedComputerId)
  const computerRangeXZ = useWorldViewStore(s => s.computerRangeXZ)

  const fileSizeDisplay = savedFileSizeBytes === null ? 'unknown' : formatBytes(savedFileSizeBytes)

  useEffect(() => {
    if (computerRangeXZ === null) return
    const computer = computers[selectedComputerId]
    if (!computer?.loc) return
    worldView.regenerateSceneFromBlocks()
  }, [computers[selectedComputerId]?.loc?.x, computers[selectedComputerId]?.loc?.z]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyY() {
    const lo = Math.max(0, Math.min(255, yMinLocal))
    const hi = Math.max(0, Math.min(255, yMaxLocal))
    useWorldViewStore.setState({ yMin: Math.min(lo, hi), yMax: Math.max(lo, hi) })
    worldView.regenerateSceneFromBlocks()
  }

  function resetY() {
    setYMinLocal(0); setYMaxLocal(255)
    useWorldViewStore.setState({ yMin: 0, yMax: 255 })
    worldView.regenerateSceneFromBlocks()
  }

  function applyXZ() {
    const v = xzRangeLocal && xzRangeLocal > 0 ? xzRangeLocal : null
    useWorldViewStore.setState({ computerRangeXZ: v })
    worldView.regenerateSceneFromBlocks()
  }

  function clearXZ() {
    setXzRangeLocal(null)
    useWorldViewStore.setState({ computerRangeXZ: null })
    worldView.regenerateSceneFromBlocks()
  }

  function applyRenderDist() {
    const v = Math.max(1, Math.min(128, renderDistLocal ?? 8))
    setRenderDistLocal(v)
    useWorldViewStore.setState({ renderDistance: v })
    worldView.updateChunkVisibility()
  }

  function resetRenderDist() {
    setRenderDistLocal(12)
    useWorldViewStore.setState({ renderDistance: 12 })
    worldView.updateChunkVisibility()
  }

  const numInput: React.CSSProperties = { width: 58, padding: '5px 6px', fontSize: 12 }

  return (
    <HeaderMenu label="Render Filters" compact align="right">
      <div className="dropdown-section">
        <div className="dropdown-row">
          <span className="dropdown-row-label">World file</span>
          <span className="dropdown-hint mono">{fileSizeDisplay}</span>
        </div>
        <div className="dropdown-divider" />

        <div className="dropdown-row">
          <span className="dropdown-row-label" style={{ flex: '0 0 28px' }}>Y</span>
          <input className="input input-mono" style={numInput} type="number" value={yMinLocal} min={0} max={255} onChange={e => setYMinLocal(Number(e.target.value))} onBlur={applyY} />
          <input className="input input-mono" style={numInput} type="number" value={yMaxLocal} min={0} max={255} onChange={e => setYMaxLocal(Number(e.target.value))} onBlur={applyY} />
          <button className="btn btn-compact" onClick={resetY}>Full</button>
        </div>

        <div className="dropdown-row">
          <span className="dropdown-row-label" style={{ flex: '0 0 64px' }}>View dist</span>
          <input className="input input-mono" style={numInput} type="number" value={renderDistLocal} min={1} max={128} onChange={e => setRenderDistLocal(Number(e.target.value))} onBlur={applyRenderDist} />
          <span className="dropdown-hint">chunks</span>
          <button className="btn btn-compact" onClick={resetRenderDist}>Reset</button>
        </div>

        <div className="dropdown-row">
          <span className="dropdown-row-label" style={{ flex: '0 0 64px' }}>XZ ±</span>
          <input className="input input-mono" style={numInput} value={xzRangeLocal ?? ''} min={1} placeholder="∞" onChange={e => setXzRangeLocal(e.target.value ? Number(e.target.value) : null)} onBlur={applyXZ} />
          <span className="dropdown-hint">blocks</span>
          <button className="btn btn-compact" onClick={clearXZ}>Clear</button>
        </div>
      </div>

      <div className="dropdown-divider" />

      <div className="dropdown-section">
        <Checkbox
          label="Multiworker"
          desc="Builds chunks on all CPU cores in parallel."
          checked={worldView.fastRender}
          onChange={v => { useWorldViewStore.setState({ fastRender: v }); worldView.regenerateSceneFromBlocks() }}
        />
        <Checkbox
          label="Skip load pauses"
          desc="Apply chunk geometry immediately. Loads faster but the UI may stutter; unchecked caps to 5ms/tick."
          checked={worldView.skipLoadYield}
          onChange={v => { useWorldViewStore.setState({ skipLoadYield: v }); worldView.regenerateSceneFromBlocks() }}
        />
        <Checkbox
          label="Lock chunks"
          desc="Keeps loaded chunks in memory permanently. Disabling sweeps out-of-range chunks."
          checked={worldView.lockChunks}
          onChange={v => { useWorldViewStore.setState({ lockChunks: v }); worldView.updateChunkVisibility() }}
        />
        <Checkbox
          label="Block hover info"
          desc="Show block name under cursor on mouse move. Requires raycasting each frame."
          checked={!worldView.lockBlockInfo}
          onChange={v => useWorldViewStore.setState({ lockBlockInfo: !v })}
        />
        <Checkbox
          label="Show orbit center"
          checked={worldView.showOrbitMarker}
          onChange={v => { useWorldViewStore.setState({ showOrbitMarker: v }); worldView.updateChunkVisibility() }}
        />
      </div>
    </HeaderMenu>
  )
})

export default RenderFilters
