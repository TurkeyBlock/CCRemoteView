'use client'

import { useWorldStore } from '@/store/useWorld'

interface Props { computerId: number }

export default function FuelGauge({ computerId }: Props) {
  const fuelLevel = useWorldStore(s => s.computers[computerId]?.fuelLevel)
  const fuelLimit = useWorldStore(s => s.computers[computerId]?.fuelLimit)
  if (fuelLevel === undefined) return null
  const pct = (fuelLimit ?? 0) > 0 ? Math.min(100, (fuelLevel / fuelLimit!) * 100) : 0
  return (
    <div className="meter" style={{ height: 10 }}>
      <div className={pct < 20 ? 'meter-fill meter-fill-amber' : 'meter-fill'} style={{ width: `${pct}%` }} />
    </div>
  )
}
