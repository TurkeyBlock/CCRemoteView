'use client'

import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useWorldViewStore } from '@/store/useWorldView'
import { useUserStore } from '@/store/useUser'
import { useWorldStore } from '@/store/useWorld'

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

  // Re-run scene when tracked computer moves (only when XZ range active)
  useEffect(() => {
    if (computerRangeXZ === null) return
    const computer = computers[selectedComputerId]
    if (!computer?.loc) return
    worldView.regenerateSceneFromBlocks()
  }, [computers[selectedComputerId]?.loc?.x, computers[selectedComputerId]?.loc?.z]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) onOpened?.()
  }

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

  const panelStyle: React.CSSProperties = { position: 'relative', background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', fontSize: '0.85em' }
  const dropdownStyle: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, zIndex: 100, background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', minWidth: 180, marginTop: 2 }
  const toggleBtnStyle: React.CSSProperties = { background: 'none', border: 'none', color: 'gray', cursor: 'pointer', fontSize: '0.85em', padding: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }
  const numInputStyle: React.CSSProperties = { width: 56, padding: '2px 4px', borderRadius: 4, border: '1px solid rgb(70,70,70)', background: 'rgb(40,40,40)', color: 'darkgray', fontSize: '0.9em', textAlign: 'center' }
  const resetBtnStyle: React.CSSProperties = { padding: '2px 6px', borderRadius: 4, border: 'none', background: 'rgb(52,52,52)', color: 'darkgray', cursor: 'pointer', fontSize: '0.8em', marginLeft: 2 }
  const sectionStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6 }
  const checkboxLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, color: 'darkgray', cursor: 'pointer', fontSize: '0.85em' }

  return (
    <div style={panelStyle}>
      <button onClick={toggle} style={toggleBtnStyle}>{open ? '▾' : '▸'} Render Filters</button>
      {open && (
        <div style={dropdownStyle}>
          <p style={{ margin: '6px 0 8px 0', color: 'gray', fontSize: '0.85em' }}>World file: {fileSizeDisplay}</p>

          <div style={sectionStyle}>
            <span style={{ fontSize: '0.8em', color: 'gray', whiteSpace: 'nowrap', flexShrink: 0 }}>Y</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" style={numInputStyle} value={yMinLocal} min={0} max={255} onChange={e => setYMinLocal(Number(e.target.value))} onBlur={applyY} />
              <span style={{ color: 'gray' }}>–</span>
              <input type="number" style={numInputStyle} value={yMaxLocal} min={0} max={255} onChange={e => setYMaxLocal(Number(e.target.value))} onBlur={applyY} />
              <button style={resetBtnStyle} onClick={resetY}>Full</button>
            </div>
          </div>

          <div style={sectionStyle}>
            <span style={{ fontSize: '0.8em', color: 'gray', whiteSpace: 'nowrap', flexShrink: 0 }}>View dist</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" style={numInputStyle} value={renderDistLocal} min={1} max={128} onChange={e => setRenderDistLocal(Number(e.target.value))} onBlur={applyRenderDist} />
              <span style={{ color: 'gray', fontSize: '0.85em' }}>chunks</span>
              <button style={resetBtnStyle} onClick={resetRenderDist}>Reset</button>
            </div>
          </div>

          <div style={{ ...sectionStyle, flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.8em', color: 'gray', whiteSpace: 'nowrap', flexShrink: 0 }}>XZ ±</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="number" style={numInputStyle} value={xzRangeLocal ?? ''} min={1} placeholder="∞" onChange={e => setXzRangeLocal(e.target.value ? Number(e.target.value) : null)} onBlur={applyXZ} />
                <span style={{ color: 'gray', fontSize: '0.85em' }}>blocks</span>
                <button style={resetBtnStyle} onClick={clearXZ}>Clear</button>
              </div>
            </div>
          </div>

          <div style={{ ...sectionStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" checked={worldView.fastRender} onChange={e => { useWorldViewStore.setState({ fastRender: e.target.checked }); worldView.regenerateSceneFromBlocks() }} />
              Multiworker
            </label>
            <p style={{ margin: '3px 0 0 0', color: 'gray', fontSize: '0.78em', fontStyle: 'italic' }}>Builds chunks on all CPU cores in parallel.</p>
          </div>

          <div style={{ ...sectionStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" checked={worldView.skipLoadYield} onChange={e => { useWorldViewStore.setState({ skipLoadYield: e.target.checked }); worldView.regenerateSceneFromBlocks() }} />
              Skip load pauses
            </label>
            <p style={{ margin: '3px 0 0 0', color: 'gray', fontSize: '0.78em', fontStyle: 'italic' }}>Apply chunk geometry immediately. Loads faster but the UI may stutter while chunks build; unchecked caps chunk application to 5 ms/tick.</p>
          </div>

          <div style={{ ...sectionStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" checked={worldView.lockChunks} onChange={e => { useWorldViewStore.setState({ lockChunks: e.target.checked }); worldView.updateChunkVisibility() }} />
              Lock chunks
            </label>
            <p style={{ margin: '3px 0 0 0', color: 'gray', fontSize: '0.78em', fontStyle: 'italic' }}>Keeps loaded chunks in memory permanently. Disabling sweeps out-of-range chunks.</p>
          </div>

          <div style={{ ...sectionStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" checked={!worldView.lockBlockInfo} onChange={e => useWorldViewStore.setState({ lockBlockInfo: !e.target.checked })} />
              Block hover info
            </label>
            <p style={{ margin: '3px 0 0 0', color: 'gray', fontSize: '0.78em', fontStyle: 'italic' }}>Show block name under cursor on mouse move. Requires raycasting each frame.</p>
          </div>

          <div style={{ ...sectionStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <label style={checkboxLabelStyle}>
              <input type="checkbox" checked={worldView.showOrbitMarker} onChange={e => { useWorldViewStore.setState({ showOrbitMarker: e.target.checked }); worldView.updateChunkVisibility() }} />
              Show orbit center
            </label>
          </div>
        </div>
      )}
    </div>
  )
})

export default RenderFilters
