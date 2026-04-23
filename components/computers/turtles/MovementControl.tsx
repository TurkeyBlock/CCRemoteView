'use client'

import { useWorldStore } from '@/store/useWorld'

interface Props { computerId: number }

export default function MovementControl({ computerId }: Props) {
  const sendCommand = useWorldStore(s => s.sendCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)

  const cmd = (c: string) => () => sendCommand(computerId, c)
  const runProgram = (name: string) => async () => {
    const code = await fetch(`/turtlePrograms/${name}.lua`).then(r => r.text())
    sendCommand(computerId, code)
  }

  return (
    <div className="group">
      <div className="btn-row-3">
        <button className="btn btn-compact" onClick={cmd('return tapi.down()')}>Down <kbd className="kbd">Q</kbd></button>
        <button className="btn btn-compact" onClick={cmd('return tapi.forward()')}>Forward <kbd className="kbd">W</kbd></button>
        <button className="btn btn-compact" onClick={cmd('return tapi.up()')}>Up <kbd className="kbd">E</kbd></button>
        <button className="btn btn-compact" onClick={cmd('return tapi.left()')}>Turn L <kbd className="kbd">A</kbd></button>
        <button className="btn btn-compact" onClick={cmd('return tapi.back()')}>Back <kbd className="kbd">S</kbd></button>
        <button className="btn btn-compact" onClick={cmd('return tapi.right()')}>Turn R <kbd className="kbd">D</kbd></button>
      </div>

      <div className="btn-row-3">
        <button className="btn btn-compact" onClick={cmd('return tapi.digDown()')}>Dig Down</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.dig()')}>Dig</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.digUp()')}>Dig Up</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.placeDown()')}>Place Dn</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.place()')}>Place</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.placeUp()')}>Place Up</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.dropDown()')}>Drop Dn</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.drop()')}>Drop</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.dropUp()')}>Drop Up</button>
      </div>

      <div className="btn-row-3">
        <button className="btn btn-compact" onClick={runProgram('veinMiner')}>Mine Vein</button>
        <button className="btn btn-compact" onClick={runProgram('treeMiner')}>Mine Tree</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.craft()')}>Craft</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.suckAll()')}>Suck All</button>
        <button className="btn btn-compact" onClick={cmd('return tapi.refuel()')}>Refuel</button>
        <button className="btn btn-compact" onClick={runProgram('skynetExpander')}>New Turtle</button>
      </div>
    </div>
  )
}
