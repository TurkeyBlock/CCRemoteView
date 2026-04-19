'use client'

import { useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'
import ComputerLocation from '../ComputerLocation'
import ButtonGrid from '../ButtonGrid'
import ScrollList from '../ScrollList'
import { btn, activeBtn, missingBtn, colors, inputStyle, sectionLabel } from '../computerStyles'

interface Props { computerId: number }

export default function StationaryPanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const sendCommand = useWorldStore(s => s.sendCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)
  const sendChatMessage = useWorldStore(s => s.sendChatMessage)
  const focusOnComputer = useWorldViewStore(s => s.focusOnComputer)
  const followComputer = useWorldViewStore(s => s.followComputer)
  const followedComputer = useWorldViewStore(s => s.followedComputer)
  const [chatInput, setChatInput] = useState('')

  if (!computer) return null

  const hasSensor = computer.peripherals?.includes('plethora:sensor')
  const isFollowing = followedComputer.computerId === computerId

  function sendChat() {
    const msg = chatInput.trim()
    if (!msg) return
    sendChatMessage(computerId, msg)
    setChatInput('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ComputerLocation loc={computer.loc ?? null} showUnavailable />
      <ButtonGrid>
        <button style={hasSensor ? btn : missingBtn} onClick={() => sendCommand(computerId, 'return sapi.sense()')}>Entity Scan</button>
        <button style={btn} onClick={() => focusOnComputer(computerId)}>Focus Camera</button>
        <button style={isFollowing ? activeBtn : btn} onClick={() => followComputer(computerId)}>Toggle Follow</button>
        <button style={btn} onClick={() => sendStopSignal(computerId)}>🛑 Stop 🛑</button>
      </ButtonGrid>

      {computer.entities && computer.entities.length > 0 && (
        <ScrollList label="Nearby Entities" count={computer.entities.length}>
          {computer.entities.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: colors.text, gap: 8 }}>
              <span style={{ color: colors.textName, whiteSpace: 'nowrap' }}>{e.name}</span>
              <span style={{ color: 'gray', fontSize: '0.9em' }}>{e.x.toFixed(1)}, {e.y.toFixed(1)}, {e.z.toFixed(1)}</span>
            </div>
          ))}
        </ScrollList>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={sectionLabel}>Chat</div>
        {computer.chatLog && computer.chatLog.length > 0 && (
          <ScrollList>
            {[...computer.chatLog].reverse().slice(0, 20).map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: colors.text, gap: 8 }}>
                <span style={{ color: colors.textName, whiteSpace: 'nowrap' }}>{msg.player}:</span>
                <span style={{ color: colors.textLight, flex: 1 }}>{msg.message}</span>
              </div>
            ))}
          </ScrollList>
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <input
            style={{ ...inputStyle, flex: 1, width: 'auto', fontSize: '0.8em' }}
            placeholder="Send message..."
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendChat() }}
          />
          <button style={{ ...btn, padding: '4px 10px', fontSize: '0.8em' }} onClick={sendChat}>Send</button>
        </div>
      </div>

      <LuaTerminal computerId={computerId} />
    </div>
  )
}
