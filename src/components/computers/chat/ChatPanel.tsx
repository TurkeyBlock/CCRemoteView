'use client'

import { useWorldStore } from '@/store/useWorld'

export default function ChatPanel() {
  const chatLog   = useWorldStore(s => s.chatLog)
  const computers = useWorldStore(s => s.computers)

  if (chatLog.length === 0) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--fg-mute)' }}>
        No chat messages yet. Messages from all computers appear here, deduplicated.
      </div>
    )
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {[...chatLog].reverse().map((msg, i) => {
          const comp = msg.computerId != null ? computers[msg.computerId] : undefined
          const source = comp?.label ? comp.label : msg.computerId != null ? `#${msg.computerId}` : '?'
          return (
            <span key={i} className="chat-line">
              <span className="chat-line-source">{source}</span>
              <span className="chat-line-user">{msg.player}</span>
              <span className="chat-line-msg">{msg.message}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
