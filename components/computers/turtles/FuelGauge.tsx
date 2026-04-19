'use client'

import { useWorldStore } from '@/store/useWorld'

interface Props { computerId: number }

export default function FuelGauge({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])
  if (!computer) return null
  return (
    <meter
      style={{ height: 20, width: '100%' }}
      value={computer.fuelLevel}
      min={0}
      max={computer.fuelLimit}
    />
  )
}
