'use client'

import { useState, forwardRef, useImperativeHandle } from 'react'
import { useWorldViewStore } from '@/store/useWorldView'

interface Props { onOpened?: () => void }
export interface PanelHandle { setOpen: (v: boolean) => void }

const BlockTransparency = forwardRef<PanelHandle, Props>(function BlockTransparency({ onOpened }, ref) {
  const [open, setOpen] = useState(false)
  useImperativeHandle(ref, () => ({ setOpen }), [])
  const [input, setInput] = useState('')
  const transparencyList = useWorldViewStore(s => s.transparencyList)
  const addToTransparencyList = useWorldViewStore(s => s.addToTransparencyList)
  const removeFromTransparencyList = useWorldViewStore(s => s.removeFromTransparencyList)

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) onOpened?.()
  }

  function add() {
    const name = input.trim()
    if (!name) return
    addToTransparencyList(name)
    setInput('')
  }

  return (
    <div style={{ position: 'relative', background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', fontSize: '0.85em' }}>
      <button onClick={toggle} style={{ background: 'none', border: 'none', color: 'gray', cursor: 'pointer', fontSize: '0.85em', padding: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {open ? '▾' : '▸'} Block Filters
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: 'rgb(30,30,30)', border: '1px solid rgb(70,70,70)', borderRadius: 6, padding: '8px 12px', minWidth: 200, marginTop: 2 }}>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <input
              style={{ flex: 1, padding: '3px 6px', borderRadius: 4, border: '1px solid rgb(70,70,70)', background: 'rgb(40,40,40)', color: 'darkgray', fontSize: '0.9em', minWidth: 0 }}
              placeholder="minecraft:stone"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
            />
            <button onClick={add} style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: 'rgb(60,120,60)', color: 'white', cursor: 'pointer', fontSize: '0.8em', whiteSpace: 'nowrap' }}>Add</button>
          </div>
          {transparencyList.length > 0 ? (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {transparencyList.map(name => (
                <div
                  key={name}
                  onClick={() => removeFromTransparencyList(name)}
                  title="Click to remove"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 6px', borderRadius: 4, background: 'rgb(40,40,40)', color: 'darkgray', cursor: 'pointer', fontSize: '0.85em' }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span style={{ color: 'rgb(150,80,80)', fontSize: '1.1em', marginLeft: 6, flexShrink: 0 }}>×</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '0.8em', color: 'gray', margin: '4px 0 0 0' }}>No blocks filtered.</p>
          )}
        </div>
      )}
    </div>
  )
})

export default BlockTransparency
