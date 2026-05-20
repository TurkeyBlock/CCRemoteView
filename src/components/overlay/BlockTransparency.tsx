'use client'

import { useState, forwardRef } from 'react'
import { FS } from '@/utils/fontSize'
import { useRenderFiltersStore } from '@/store/useWorldView'
import { sceneBridge } from '@/store/sceneBridge'
import { HeaderMenu } from '@/components/ui'
import ConfirmDialog from '@/components/modals/ConfirmDialog'
import { usePanelHandle, type PanelHandle } from './panelHandle'

interface Props { onOpened?: () => void }
export type { PanelHandle }

const BlockTransparency = forwardRef<PanelHandle, Props>(function BlockTransparency({ onOpened }, ref) {
  const [, setOpen] = useState(false)
  usePanelHandle(ref, setOpen)
  const [input, setInput] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingOpacity, setPendingOpacity] = useState<Record<string, number>>({})
  const [showOpacityConfirm, setShowOpacityConfirm] = useState(false)

  const transparencyList    = useRenderFiltersStore(s => s.transparencyList)
  const addToTransparencyList    = useRenderFiltersStore(s => s.addToTransparencyList)
  const removeFromTransparencyList = useRenderFiltersStore(s => s.removeFromTransparencyList)
  const blockPickMode       = useRenderFiltersStore(s => s.blockPickMode)
  const pendingFilterBlocks = useRenderFiltersStore(s => s.pendingFilterBlocks)
  const setBlockPickMode    = useRenderFiltersStore(s => s.setBlockPickMode)
  const confirmPendingFilterBlocks  = useRenderFiltersStore(s => s.confirmPendingFilterBlocks)
  const cancelPendingFilterBlocks   = useRenderFiltersStore(s => s.cancelPendingFilterBlocks)
  const removePendingFilterBlock    = useRenderFiltersStore(s => s.removePendingFilterBlock)
  const miningMode          = useRenderFiltersStore(s => s.miningMode)
  const miningOpacityMap    = useRenderFiltersStore(s => s.miningOpacityMap)

  function add() {
    const name = input.trim()
    if (!name) return
    addToTransparencyList(name)
    setInput('')
  }

  const pendingCount = pendingFilterBlocks.length

  return (
    <>
      <HeaderMenu label="Block Filters" compact align="right">
        <div className="dropdown-section">
          <div className="dropdown-row">
            <input
              className="input input-mono"
              style={{ fontSize: FS['12'] }}
              placeholder="minecraft:stone"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
            />
            <button className="btn btn-compact btn-primary" onClick={add}>Add</button>
            <button
              className={`btn btn-compact${blockPickMode ? ' btn-primary' : ''}`}
              title={blockPickMode ? 'Exit pick mode (Esc)' : 'Click blocks in the scene to add them'}
              onClick={() => setBlockPickMode(!blockPickMode)}
            >Pick</button>
          </div>

          {pendingCount > 0 && (
            <div className="group-tight" style={{ marginTop: 2 }}>
              <div className="heading">Pending ({pendingCount})</div>
              {pendingFilterBlocks.map(name => (
                <div key={name} className="dropdown-row" style={{ background: 'var(--surface-3)', padding: '4px 8px', borderRadius: 3 }}>
                  <span className="mono" style={{ flex: 1, fontSize: FS['11'] }}>{name}</span>
                  <button className="floating-close" onClick={() => removePendingFilterBlock(name)} title="Remove">×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-compact btn-primary" style={{ flex: 1 }} onClick={() => setShowConfirm(true)}>
                  Apply ({pendingCount})
                </button>
                <button className="btn btn-compact" onClick={() => cancelPendingFilterBlocks()}>Cancel</button>
              </div>
            </div>
          )}

          {transparencyList.length === 0 ? (
            <div className="explainer">No blocks filtered.</div>
          ) : (
            <div className="group-tight">
              {transparencyList.map(name => (
                <div key={name} className="dropdown-row" style={{ background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 3 }}>
                  <span className="mono" style={{ flex: 1, fontSize: FS['11'] }}>{name}</span>
                  {miningMode && (
                    <>
                      <input
                        type="range"
                        min={0} max={100}
                        value={Math.round((pendingOpacity[name] ?? miningOpacityMap[name] ?? 0.3) * 100)}
                        style={{ width: 64 }}
                        onChange={e => setPendingOpacity(p => ({ ...p, [name]: Number(e.target.value) / 100 }))}
                      />
                      <input
                        type="number"
                        className="input input-mono"
                        style={{ width: 42, padding: '3px 5px', fontSize: FS['11'] }}
                        min={0} max={100}
                        value={Math.round((pendingOpacity[name] ?? miningOpacityMap[name] ?? 0.3) * 100)}
                        onChange={e => setPendingOpacity(p => ({ ...p, [name]: Math.max(0, Math.min(100, Number(e.target.value))) / 100 }))}
                      />
                      <span style={{ fontSize: FS['11'], color: 'var(--fg-mute)', marginLeft: 1 }}>%</span>
                    </>
                  )}
                  <button
                    className="floating-close"
                    onClick={() => {
                      removeFromTransparencyList(name)
                      setPendingOpacity(p => { const next = { ...p }; delete next[name]; return next })
                    }}
                    title="Remove"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {miningMode && Object.keys(pendingOpacity).length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button className="btn btn-compact btn-primary" style={{ flex: 1 }} onClick={() => setShowOpacityConfirm(true)}>
                Apply ({Object.keys(pendingOpacity).length})
              </button>
              <button className="btn btn-compact" onClick={() => setPendingOpacity({})}>Revert</button>
            </div>
          )}

          <div className="explainer" style={{ marginTop: 4 }}>
            {miningMode
              ? 'Set opacity per block. Lower % = more transparent. 0% = fully hidden.'
              : 'Hidden blocks are excluded from the world render. Useful for x-raying common blocks like stone or dirt.'}
          </div>
        </div>
      </HeaderMenu>

      <ConfirmDialog
        open={showConfirm}
        title="Apply filter changes?"
        message={`Add ${pendingCount} block${pendingCount !== 1 ? 's' : ''} to the filter list? The scene will rebuild.`}
        onConfirm={() => { setShowConfirm(false); confirmPendingFilterBlocks() }}
        onCancel={() => setShowConfirm(false)}
        confirmLabel="Apply"
      />
      <ConfirmDialog
        open={showOpacityConfirm}
        title="Apply opacity changes?"
        message={`Update opacity for ${Object.keys(pendingOpacity).length} block${Object.keys(pendingOpacity).length !== 1 ? 's' : ''}? The scene will rebuild.`}
        onConfirm={() => {
          setShowOpacityConfirm(false)
          useRenderFiltersStore.setState({ miningOpacityMap: { ...miningOpacityMap, ...pendingOpacity } })
          setPendingOpacity({})
          sceneBridge.regenerateSceneFromBlocks()
        }}
        onCancel={() => setShowOpacityConfirm(false)}
        confirmLabel="Apply"
      />
    </>
  )
})

export default BlockTransparency
