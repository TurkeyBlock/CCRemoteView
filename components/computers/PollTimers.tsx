'use client'

import { useEffect, useState } from 'react'
import { useWorldStore } from '@/store/useWorld'
import { MeterRow } from '@/components/ui'

const MODEM_HEARTBEAT_INTERVAL_S = 60
const MODEM_MAX_MISSES           = 3
const MODEM_HEARTBEAT_WINDOW_S   = 65
const HTTP_MODEM_CHECK_INTERVAL_S = 60

interface Props { computerId: number }

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '—'
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
    const elapsed   = now - lastSeen
    const remaining = Math.max(0, interval * 1000 - elapsed)
    return (
      <div className="group-tight">
        <MeterRow label="Next poll" value={remaining / 1000} max={interval} />
      </div>
    )
  }

  const lastSeen          = computer.lastSeen ?? 0
  const viaModem          = !!computer.via_modem
  const hasModemPeripheral = !!computer.has_modem_peripheral
  const wsConnected       = !!computer.ws_connected

  const modemEntry        = Object.values(computers).find(c => c?.type === 'modem')
  const modemLastSeen     = modemEntry?.lastSeen ?? 0
  const modemPollInterval = modemEntry?.poll_interval ?? 1

  // ── WebSocket connected: solid bar, no countdown ──────────
  if (wsConnected) {
    return (
      <div className="group-tight">
        <MeterRow label="WebSocket" value={1} max={1} solid solidLabel="active" />
        {viaModem && (() => {
          const msToNextHB = (modemLastSeen + MODEM_HEARTBEAT_INTERVAL_S * 1000) - now
          const elapsed = Math.max(0, MODEM_HEARTBEAT_INTERVAL_S * 1000 - Math.max(0, msToNextHB))
          return (
            <MeterRow
              label="Heartbeat"
              value={elapsed / 1000}
              max={MODEM_HEARTBEAT_INTERVAL_S}
              amber
              title={`Reboots after ${MODEM_MAX_MISSES} misses (~${MODEM_HEARTBEAT_WINDOW_S * MODEM_MAX_MISSES}s)`}
            />
          )
        })()}
      </div>
    )
  }

  // ── Via modem (no WS): heartbeat countdown ────────────────
  if (viaModem) {
    const msToNextHB = (modemLastSeen + MODEM_HEARTBEAT_INTERVAL_S * 1000) - now
    const elapsed = Math.max(0, MODEM_HEARTBEAT_INTERVAL_S * 1000 - Math.max(0, msToNextHB))
    return (
      <div className="group-tight">
        <MeterRow label="Poll" value={Math.max(0, (modemLastSeen + modemPollInterval * 1000) - now) / 1000} max={modemPollInterval} />
        <MeterRow
          label="Heartbeat"
          value={elapsed / 1000}
          max={MODEM_HEARTBEAT_INTERVAL_S}
          amber
          title={`Reboots after ${MODEM_MAX_MISSES} misses (~${MODEM_HEARTBEAT_WINDOW_S * MODEM_MAX_MISSES}s)`}
        />
      </div>
    )
  }

  // ── Direct HTTP ───────────────────────────────────────────
  const wsCheckMs = (lastSeen + 30 * 1000) - now   // getWsRequest poll every 30s
  const modemCheckMs = hasModemPeripheral ? (lastSeen + HTTP_MODEM_CHECK_INTERVAL_S * 1000) - now : null

  return (
    <div className="group-tight">
      <MeterRow label="WS check" value={Math.max(0, wsCheckMs) / 1000} max={30} />
      {modemCheckMs !== null && (
        <MeterRow label="Modem check" value={Math.max(0, modemCheckMs) / 1000} max={HTTP_MODEM_CHECK_INTERVAL_S} amber />
      )}
    </div>
  )
}
