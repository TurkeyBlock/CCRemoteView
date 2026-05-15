'use client'

import { useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { useComputerPanel } from '../useComputerPanel'
import LuaTerminal from '../LuaTerminal'
import { Section } from '@/components/ui'
import ActionButtons from '../ActionButtons'
import EntityList from '../EntityList'

interface Props { computerId: number }

export default function StationaryPanel({ computerId }: Props) {
  const { computer } = useComputerPanel(computerId)
  const sendChatMessage = useWorldStore(s => s.sendChatMessage)
  const [chatInput, setChatInput] = useState('')

  if (!computer) return null

  const hasSensor = computer.peripherals?.includes('plethora:sensor')

  function sendChat() {
    const msg = chatInput.trim()
    if (!msg) return
    sendChatMessage(computerId, msg)
    setChatInput('')
  }

  return (
    <div className="group">
      <ActionButtons computerId={computerId} hasSensor={hasSensor} />
      <EntityList entities={computer.entities} />

      <Section label="Chat">
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
      </Section>

      <Section label="Terminal">
        <LuaTerminal computerId={computerId} />
      </Section>
    </div>
  )
}
