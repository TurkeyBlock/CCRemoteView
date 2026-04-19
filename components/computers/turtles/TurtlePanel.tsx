'use client'

import { useWorldStore } from '@/store/useWorld'
import ComputerLocation from '../ComputerLocation'
import TurtleInventory from './TurtleInventory'
import FuelGauge from './FuelGauge'
import MovementControl from './MovementControl'
import LuaTerminal from '../LuaTerminal'

interface Props { computerId: number }

export default function TurtlePanel({ computerId }: Props) {
  const computer = useWorldStore(s => s.computers[computerId])

  return (
    <>
      <ComputerLocation loc={computer?.loc} />
      <TurtleInventory computerId={computerId} />
      <FuelGauge computerId={computerId} />
      <MovementControl computerId={computerId} />
      <LuaTerminal computerId={computerId} />
    </>
  )
}
