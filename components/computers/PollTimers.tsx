'use client'

import { useEffect, useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { Led, MeterRow } from '@/components/ui'
import type { LedKind } from '@/components/ui'

interface Props { computerId: number }

const POLL_INTERVAL_MS = 30_000
const STALE_MS = 90_000

export function connLedKind(wsConnected: boolean, lastPoll: number | null | undefined, now: number): LedKind {
  if (wsConnected) return 'on'
  if (!lastPoll || now - lastPoll > STALE_MS) return 'off'
  return 'amber'
}

function fmtPollCountdown(ms: number): string {
  const neg = ms < 0
  const abs = Math.abs(ms)
  const s = Math.ceil(abs / 1000)
  const str = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  return neg ? `-${str}` : str
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

  const wsConnected = !!computer.ws_connected
  const lastPoll    = computer.lastPoll ?? null
  const kind        = connLedKind(wsConnected, lastPoll, now)
  const label       = wsConnected ? 'WebSocket connected' : lastPoll ? 'Polling' : 'No contact'
  const pollMs      = lastPoll !== null ? POLL_INTERVAL_MS - (now - lastPoll) : null

  return (
    <div className="group-tight">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Led kind={kind} />
        <span className="meter-row-value">{label}</span>
      </div>
      {pollMs !== null && (
        <MeterRow
          label="Next poll"
          value={Math.max(0, pollMs) / 1000}
          max={POLL_INTERVAL_MS / 1000}
          amber={pollMs <= 0}
          valueLabel={fmtPollCountdown(pollMs)}
        />
      )}
    </div>
  )
}
