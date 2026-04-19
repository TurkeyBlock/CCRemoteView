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
    <>
      <textarea
        style={{ height: 24, backgroundColor: '#383e42', color: 'darkgray', width: '100%', boxSizing: 'border-box' }}
        value={cmd}
        onChange={e => setCmd(e.target.value)}
        onKeyDown={e => e.stopPropagation()}
        placeholder="write lua code here, e.g. return 42"
      />
      <button
        style={{ backgroundColor: '#383e42', color: 'darkgray' }}
        onClick={() => sendCommand(computerId, cmd)}
      >
        Execute
      </button>
      <div style={{ backgroundColor: '#383e42', color: 'darkgray', wordWrap: 'break-word', width: 300 }}>
        {commandResult[selectedComputerId]}
      </div>
    </>
  )
}
