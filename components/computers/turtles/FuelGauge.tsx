'use client'

import { useWorldStore } from '@/store/useWorld'

interface Props { computerId: number }

export default function FuelGauge({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  if (!computer) return null
  const pct = computer.fuelLimit > 0 ? Math.min(100, (computer.fuelLevel / computer.fuelLimit) * 100) : 0
  return (
    <div className="meter" style={{ height: 10 }}>
      <div className={pct < 20 ? 'meter-fill meter-fill-amber' : 'meter-fill'} style={{ width: `${pct}%` }} />
    </div>
  )
}
