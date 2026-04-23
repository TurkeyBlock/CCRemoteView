'use client'

import { useState, forwardRef, useImperativeHandle } from 'react'
import { useWorldViewStore } from '@/store/useWorldView'
import { HeaderMenu } from '@/components/ui'

interface Props { onOpened?: () => void }
export interface PanelHandle { setOpen: (v: boolean) => void }

const BlockTransparency = forwardRef<PanelHandle, Props>(function BlockTransparency({ onOpened }, ref) {
  const [open, setOpen] = useState(false)
  useImperativeHandle(ref, () => ({ setOpen }), [])
  const [input, setInput] = useState('')
  const transparencyList = useWorldViewStore(s => s.transparencyList)
  const addToTransparencyList = useWorldViewStore(s => s.addToTransparencyList)
  const removeFromTransparencyList = useWorldViewStore(s => s.removeFromTransparencyList)

  function add() {
    const name = input.trim()
    if (!name) return
    addToTransparencyList(name)
    setInput('')
  }

  return (
    <HeaderMenu label="Block Filters" compact align="right">
      <div className="dropdown-section">
        <div className="dropdown-row">
          <input
            className="input input-mono"
            style={{ fontSize: 12 }}
            placeholder="minecraft:stone"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
          />
          <button className="btn btn-compact btn-primary" onClick={add}>Add</button>
        </div>

        {transparencyList.length === 0 ? (
          <div className="explainer">No blocks filtered.</div>
        ) : (
          <div className="group-tight">
            {transparencyList.map(name => (
              <div key={name} className="dropdown-row" style={{ background: 'var(--surface-2)', padding: '4px 8px', borderRadius: 3 }}>
                <span className="mono" style={{ flex: 1, fontSize: 11 }}>{name}</span>
                <button
                  className="floating-close"
                  onClick={() => removeFromTransparencyList(name)}
                  title="Remove"
                >×</button>
              </div>
            ))}
          </div>
        )}

        <div className="explainer" style={{ marginTop: 4 }}>
          Hidden blocks are excluded from the world render. Useful for x-raying common blocks like stone or dirt.
        </div>
      </div>
    </HeaderMenu>
  )
})

export default BlockTransparency
