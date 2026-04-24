'use client'

import { useEffect, useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { Led, MeterRow } from '@/components/ui'

interface Props { computerId: number }

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0s'
  const s = Math.ceil(ms / 1000)
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

export default function PollTimers({ computerId }: Props) {
  const computers = useWorldStore(s => s.computers)
  const computer  = computers[computerId]
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  if (!computer) return null

  // ── Modem device ──────────────────────────────────────────
  if (computer.type === 'modem') {
    const interval  = computer.poll_interval ?? 1
    const lastSeen  = computer.lastSeen ?? 0
    const remaining = Math.max(0, (lastSeen + interval * 1000) - now)
    return (
      <div className="group-tight">
        <MeterRow label="Next poll" value={remaining / 1000} max={interval} />
      </div>
    )
  }

  const wsConnected = !!computer.ws_connected
  const wsRequestAt = computer.ws_request_at ?? null

  if (wsConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Led kind="on" />
        <span className="meter-row-value">WebSocket connected</span>
      </div>
    )
  }

  const deadline  = wsRequestAt ? wsRequestAt + 30_000 : null
  const countdown = deadline !== null ? Math.max(0, deadline - now) : null

  return (
    <div className="group-tight">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Led kind="amber" />
        <span className="meter-row-value">Polling</span>
      </div>
      {countdown !== null && (
        <MeterRow label="WS open in ≤" value={countdown / 1000} max={30} amber />
      )}
    </div>
  )
}
