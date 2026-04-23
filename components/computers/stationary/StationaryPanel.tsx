'use client'

import { useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'

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
    <div className="group">
      <Section label="Actions">
        <div className="btn-row-2">
          <button
            className={`btn btn-compact${hasSensor ? '' : ' btn-disabled'}`}
            onClick={() => sendCommand(computerId, 'return sapi.sense()')}
          >Entity Scan</button>
          <button className="btn btn-compact" onClick={() => focusOnComputer(computerId)}>Focus</button>
          <button
            className={`btn btn-compact${isFollowing ? ' btn-toggled' : ''}`}
            onClick={() => followComputer(computerId)}
          >{isFollowing ? 'Unfollow' : 'Follow'}</button>
          <button className="btn btn-compact btn-danger" onClick={() => sendStopSignal(computerId)}>Stop</button>
        </div>
      </Section>

      {computer.entities && computer.entities.length > 0 && (
        <Section label={`Entities (${computer.entities.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 160, overflowY: 'auto' }}>
            {computer.entities.map(e => (
              <div key={e.id} className="row-between" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>{e.name}</span>
                <span className="muted" style={{ fontSize: 11 }}>{e.x.toFixed(1)}, {e.y.toFixed(1)}, {e.z.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section label="Chat">
        <div className="chat">
          {computer.chatLog && computer.chatLog.length > 0 && (
            <div className="chat-log">
              {[...computer.chatLog].reverse().slice(0, 20).map((msg, i) => (
                <span key={i} className="chat-line">
                  <span className="chat-line-user">{msg.player}</span>
                  <span className="chat-line-msg">{msg.message}</span>
                </span>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Send message..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') sendChat() }}
            />
            <button className="btn" onClick={sendChat}>Send</button>
          </div>
        </div>
      </Section>

      <Section label="Terminal">
        <LuaTerminal computerId={computerId} />
      </Section>
    </div>
  )
}
