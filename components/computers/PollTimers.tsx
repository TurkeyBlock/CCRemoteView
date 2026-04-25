'use client'

import { useEffect, useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { Led, MeterRow } from '@/components/ui'
import type { LedKind } from '@/components/ui'

interface Props { computerId: number }

const POLL_INTERVAL_MS = 30_000

export function connLedKind(wsConnected: boolean, wsRequestAt: number | null | undefined): LedKind {
  if (wsConnected) return 'on'
  if (wsRequestAt) return 'amber'
  return 'off'
}

function fmtCountdown(ms: number): string {
  const neg = ms < 0
  const abs = Math.abs(ms)
  const s = Math.ceil(abs / 1000)
  const str = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  return neg ? `-${str}` : str
}

export default function PollTimers({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  if (!computer) return null

  const wsConnected = !!computer.ws_connected
  const wsRequestAt = computer.ws_request_at ?? null
  const kind        = connLedKind(wsConnected, wsRequestAt)
  const label       = wsConnected ? 'WebSocket connected' : wsRequestAt ? 'Waiting for wakeup' : 'Idle'
  const wakeMs      = wsRequestAt !== null ? POLL_INTERVAL_MS - (now - wsRequestAt) : null

  return (
    <div className="group-tight">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Led kind={kind} />
        <span className="meter-row-value">{label}</span>
      </div>
      {wakeMs !== null && (
        <MeterRow
          label="Next poll"
          value={Math.max(0, wakeMs) / 1000}
          max={POLL_INTERVAL_MS / 1000}
          amber={wakeMs <= 0}
          valueLabel={fmtCountdown(wakeMs)}
        />
      )}
    </div>
  )
}
