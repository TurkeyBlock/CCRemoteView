'use client'

import { useEffect, useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { Led, MeterRow } from '@/components/ui'
import type { LedKind } from '@/components/ui'

interface Props { computerId: number }

const POLL_INTERVAL_S = parseInt(process.env.NEXT_PUBLIC_COMPUTER_POLL_INTERVAL_S ?? '30', 10)
export const POLL_INTERVAL_MS = POLL_INTERVAL_S * 1_000

export function connLedKind(
  wsConnected: boolean,
  wsRequestAt: number | null | undefined,
  now?: number,
): LedKind {
  if (wsConnected) return 'on'
  if (wsRequestAt) {
    if (now !== undefined && now - wsRequestAt > POLL_INTERVAL_MS) return 'red'
    return 'amber'
  }
  return 'off'
}

function fmtCountdown(ms: number): string {
  const neg = ms < 0
  const abs = Math.abs(ms)
  const s = Math.ceil(abs / 1000)
  const timeString = s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  return neg ? `-${timeString}` : timeString
}

export default function PollTimers({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  const [now, setNow] = useState(Date.now)

  const wsRequestAt = computer?.wsRequestAt ?? null
  const wsConnected = !!computer?.wsConnected

  useEffect(() => {
    if (!wsRequestAt || wsConnected) return
    if (Date.now() - wsRequestAt > POLL_INTERVAL_MS) { setNow(Date.now()); return }
    const id = setInterval(() => {
      const now = Date.now()
      setNow(now)
      if (now - wsRequestAt > POLL_INTERVAL_MS) clearInterval(id)
    }, 500)
    return () => clearInterval(id)
  }, [wsRequestAt, wsConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!computer) return null

  const wakeMs = wsRequestAt !== null ? POLL_INTERVAL_MS - (now - wsRequestAt) : null
  const overdue = wakeMs !== null && wakeMs < 0
  const kind = connLedKind(wsConnected, wsRequestAt, now)
  const label = wsConnected      ? 'WebSocket connected'
    : overdue                    ? 'Computer not active'
    : wsRequestAt                ? 'Waiting for wakeup'
    :                              'Idle'

  return (
    <div className="group-tight">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Led kind={kind} />
        <span className="meter-row-value">{label}</span>
      </div>
      {wsRequestAt !== null && !overdue && wakeMs !== null && (
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
