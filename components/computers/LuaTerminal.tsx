'use client'

import { useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'

interface Props { computerId: number }

export default function LuaTerminal({ computerId }: Props) {
  const [cmd, setCmd] = useState('')
  const sendCommand = useWorldStore(s => s.sendCommand)
  const commandResult = useWorldStore(s => s.commandResult)
  const selectedComputerId = useWorldViewStore(s => s.selectedComputerId)

  return (
    <div className="code-pad">
      <textarea
        className="code-pad-ta"
        value={cmd}
        onChange={e => setCmd(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendCommand(computerId, cmd)
        }}
        placeholder="-- write lua here, e.g. return 42"
      />
      <div className="code-pad-foot">
        <span className="muted" style={{ fontSize: 11 }}><kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">↵</kbd> to run</span>
        <button className="btn btn-compact btn-primary" onClick={() => sendCommand(computerId, cmd)}>Execute</button>
      </div>
      {commandResult[selectedComputerId] && (
        <div className="code-pad-result">{commandResult[selectedComputerId]}</div>
      )}
    </div>
  )
}
