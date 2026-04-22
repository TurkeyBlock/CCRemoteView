'use client'

import { useEffect, useState } from 'react'
import { useWorldStore } from '@/store/useWorld'

// ── Timing constants (mirror the Lua rc files) ───────────────────────────────
// rcTurtle/rcMinecart/rcPlayer/rcStationary main():
const HTTP_MODEM_CHECK_INTERVAL_S = 60   // MODEM_CHECK_INTERVAL — HTTP computers check if a modem came online

// rcXxx modem_main():
const MODEM_HEARTBEAT_WINDOW_S    = 65   // HEARTBEAT_WINDOW — time before a missed heartbeat is declared
const MODEM_MAX_MISSES            = 3    // MAX_MISSES — reboots after this many consecutive misses

// modemServer.lua:
const MODEM_HEARTBEAT_INTERVAL_S  = 60   // HEARTBEAT_INTERVAL — how often the modem broadcasts a heartbeat
// ────────────────────────────────────────────────────────────────────────────

interface Props { computerId: number }

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '—'
  const s = Math.ceil(ms / 1000)
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${s}s`
}

const ROW: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: '0.72em', color: 'gray',
}
const LABEL: React.CSSProperties = { textTransform: 'uppercase', letterSpacing: '0.05em' }
const VALUE: React.CSSProperties = { color: 'rgb(160,160,160)', fontFamily: 'monospace' }

export default function PollTimers({ computerId }: Props) {
  const computers  = useWorldStore(s => s.computers)
  const computer   = computers[computerId]
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  if (!computer || computer.type === 'modem') return null

  const lastSeen      = computer.lastSeen ?? 0
  const viaModem      = !!computer.via_modem
  const hasModemPeripheral = !!computer.has_modem_peripheral

  // Find the modem server computer entry (type === 'modem')
  const modemEntry = Object.values(computers).find(c => c?.type === 'modem')
  const modemLastSeen     = modemEntry?.lastSeen ?? 0
  const modemPollInterval = modemEntry?.poll_interval ?? 1  // seconds

  // ── Timer 1: next command poll ───────────────────────────────────────────
  let pollLabel: string
  if (viaModem) {
    // Poll is driven by the modem server's own HTTP poll cycle
    if (modemPollInterval <= 1) {
      pollLabel = '~1s'
    } else {
      const ms = (modemLastSeen + modemPollInterval * 1000) - now
      pollLabel = fmtCountdown(ms)
    }
  } else {
    const interval = computer.poll_interval ?? 1
    if (interval <= 1) {
      pollLabel = '~1s'
    } else {
      const ms = (lastSeen + interval * 1000) - now
      pollLabel = fmtCountdown(ms)
    }
  }

  // ── Timer 2: modem check ─────────────────────────────────────────────────
  // Case A — HTTP mode with a modem peripheral: checks every 60s if a modem server came online
  // Case B — Modem mode: heartbeat window countdown; reboots after MAX_MISSES misses
  let modemCheckRow: React.ReactNode = null

  if (!viaModem && hasModemPeripheral) {
    // Case A: time until next "is modem online?" check
    const ms = (lastSeen + HTTP_MODEM_CHECK_INTERVAL_S * 1000) - now
    modemCheckRow = (
      <div style={ROW}>
        <span style={LABEL}>Modem check</span>
        <span style={VALUE}>{fmtCountdown(ms)}</span>
      </div>
    )
  } else if (viaModem) {
    // Case B: time until next heartbeat expected from modem server
    // The heartbeat resets the HEARTBEAT_WINDOW timer on the computer side.
    // We approximate from modemLastSeen: the modem sends heartbeats every MODEM_HEARTBEAT_INTERVAL_S.
    const msToNextHB = (modemLastSeen + MODEM_HEARTBEAT_INTERVAL_S * 1000) - now
    const windowMs   = MODEM_HEARTBEAT_WINDOW_S * 1000
    const missMs     = windowMs * MODEM_MAX_MISSES
    modemCheckRow = (
      <div style={ROW}>
        <span style={LABEL}>Next heartbeat</span>
        <span style={VALUE} title={`Reboots after ${MODEM_MAX_MISSES} misses (~${MODEM_HEARTBEAT_WINDOW_S * MODEM_MAX_MISSES}s)`}>
          {fmtCountdown(msToNextHB)}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
      <div style={ROW}>
        <span style={LABEL}>Next poll</span>
        <span style={VALUE}>{pollLabel}</span>
      </div>
      {modemCheckRow}
    </div>
  )
}
