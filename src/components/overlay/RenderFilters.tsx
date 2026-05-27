'use client'

import { useState, forwardRef } from 'react'
import { FS } from '@/utils/fontSize'
import { useWorldViewStore, useRenderFiltersStore } from '@/store/useWorldView'
import { sceneBridge } from '@/store/sceneBridge'
import { useUserStore } from '@/store/useUser'
import { HeaderMenu, Checkbox } from '@/components/ui'
import { usePanelHandle, type PanelHandle } from './panelHandle'

interface Props { onOpened?: () => void }
export type { PanelHandle }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const RenderFilters = forwardRef<PanelHandle, Props>(function RenderFilters({ onOpened }, ref) {
  const [, setOpen] = useState(false)
  usePanelHandle(ref, setOpen)
  const [yMinLocal, setYMinLocal] = useState(0)
  const [yMaxLocal, setYMaxLocal] = useState(255)
  const [renderDistLocal, setRenderDistLocal] = useState(12)

  const fastRender    = useWorldViewStore(s => s.fastRender)
  const skipLoadYield = useWorldViewStore(s => s.skipLoadYield)
  const lockChunks    = useWorldViewStore(s => s.lockChunks)
  const lockBlockInfo = useWorldViewStore(s => s.lockBlockInfo)
  const showOrbitMarker = useWorldViewStore(s => s.showOrbitMarker)
  const miningMode       = useRenderFiltersStore(s => s.miningMode)
  const simpleOcclusion  = useWorldViewStore(s => s.simpleOcclusion)
  const savedFileSizeBytes = useUserStore(s => s.savedFileSizeBytes)
  const fileSizeDisplay = savedFileSizeBytes === null ? 'unknown' : formatBytes(savedFileSizeBytes)

  function toggleMiningMode() {
    const on = !miningMode
    if (on) {
      const capped = Math.min(renderDistLocal, 4)
      setRenderDistLocal(capped)
      const { transparencyList, miningOpacityMap } = useRenderFiltersStore.getState()
      const seededMap = { ...miningOpacityMap }
      for (const name of transparencyList) {
        if (!(name in seededMap)) seededMap[name] = 0.3
      }
      useRenderFiltersStore.setState({ miningMode: true, miningOpacityMap: seededMap })
      useWorldViewStore.setState({ renderDistance: capped })
    } else {
      useRenderFiltersStore.setState({ miningMode: false })
    }
    sceneBridge.regenerateSceneFromBlocks()
  }

  function applyY() {
    const lo = Math.max(0, Math.min(255, yMinLocal))
    const hi = Math.max(0, Math.min(255, yMaxLocal))
    useRenderFiltersStore.setState({ yMin: Math.min(lo, hi), yMax: Math.max(lo, hi) })
    sceneBridge.regenerateSceneFromBlocks()
  }

  function resetY() {
    setYMinLocal(0); setYMaxLocal(255)
    useRenderFiltersStore.setState({ yMin: 0, yMax: 255 })
    sceneBridge.regenerateSceneFromBlocks()
  }

  function applyRenderDist() {
    const v = Math.max(1, Math.min(128, renderDistLocal ?? 8))
    setRenderDistLocal(v)
    useWorldViewStore.setState({ renderDistance: v })
    sceneBridge.updateChunkVisibility()
  }

  function resetRenderDist() {
    setRenderDistLocal(12)
    useWorldViewStore.setState({ renderDistance: 12 })
    sceneBridge.updateChunkVisibility()
  }

  const numInput: React.CSSProperties = { width: 58, padding: '5px 6px', fontSize: FS['12'] }

  return (
    <HeaderMenu label="Render Filters" compact align="right">
      <div className="dropdown-section">
        <button
          className={`btn btn-compact btn-block${miningMode ? ' btn-primary' : ''}`}
          onClick={toggleMiningMode}
        >{miningMode ? 'Mining Mode: ON' : 'Mining Mode'}</button>
      </div>

      <div className="dropdown-divider" />

      <div className="dropdown-section">
        <div className="dropdown-row">
          <span className="dropdown-row-label">World file</span>
          <span className="dropdown-hint mono">{fileSizeDisplay}</span>
        </div>
        <div className="dropdown-divider" />

        <div className="dropdown-row">
          <span className="dropdown-row-label" style={{ flex: '0 0 64px' }}>Y</span>
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

      </div>

      <div className="dropdown-divider" />

      <div className="dropdown-section">
        <Checkbox
          label="Multiworker"
          desc="Builds chunks on all CPU cores in parallel."
          checked={fastRender}
          onChange={v => { useWorldViewStore.setState({ fastRender: v }); sceneBridge.regenerateSceneFromBlocks() }}
        />
        <Checkbox
          label="Skip load pauses"
          desc="Apply chunk geometry immediately. Loads faster but the UI may stutter; unchecked caps to 5ms/tick."
          checked={skipLoadYield}
          onChange={v => useWorldViewStore.setState({ skipLoadYield: v })}
        />
        <Checkbox
          label="Lock chunks"
          desc="Keeps loaded chunks in memory permanently. Disabling sweeps out-of-range chunks."
          checked={lockChunks}
          onChange={v => { useWorldViewStore.setState({ lockChunks: v }); sceneBridge.updateChunkVisibility() }}
        />
        <Checkbox
          label="Block hover info"
          desc="Show block name under cursor on mouse move. Requires raycasting each frame."
          checked={!lockBlockInfo}
          onChange={v => useWorldViewStore.setState({ lockBlockInfo: !v })}
        />
        <Checkbox
          label="Alpha-cutout occlusion"
          desc="Suppresses faces between adjacent same-type foliage (like leaves), matching how glass handles seams. Reduces face count in leaf-heavy areas."
          checked={simpleOcclusion}
          onChange={v => { useWorldViewStore.setState({ simpleOcclusion: v }); sceneBridge.regenerateSceneFromBlocks() }}
        />
        <Checkbox
          label="Show orbit center"
          checked={showOrbitMarker}
          onChange={v => { useWorldViewStore.setState({ showOrbitMarker: v }); sceneBridge.updateChunkVisibility() }}
        />
      </div>
    </HeaderMenu>
  )
})

export default RenderFilters
