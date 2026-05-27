'use client'

import { useState } from 'react'
import { FS } from '@/utils/fontSize'
import { useWorldStore } from '@/store/useWorld'

interface Props { computerId: number }

export default function LuaTerminal({ computerId }: Props) {
  const [cmd, setCmd] = useState('')
  const sendCommand = useWorldStore(s => s.sendCommand)
  const commandResult = useWorldStore(s => s.commandResult[computerId])

  const run = () => sendCommand(computerId, cmd)

  return (
    <div className="code-pad">
      <textarea
        className="code-pad-ta"
        value={cmd}
        onChange={e => setCmd(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run()
        }}
        placeholder="-- write lua here, e.g. tapi.scan() | os.reboot() | return 42"
      />
      <div className="code-pad-foot">
        <span className="muted" style={{ fontSize: FS['11'] }}><kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">↵</kbd> to run</span>
        <button className="btn btn-compact btn-primary" onClick={run}>Execute</button>
      </div>
      {commandResult != null && (
        <div className="code-pad-result">
          {typeof commandResult === 'object' ? JSON.stringify(commandResult, null, 2) : String(commandResult)}
        </div>
      )}
    </div>
  )
}
