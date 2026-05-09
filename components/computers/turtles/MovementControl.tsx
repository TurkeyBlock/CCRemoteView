'use client'

import { useWorldStore } from '@/store/useWorld'

interface Props { computerId: number }

export default function MovementControl({ computerId }: Props) {
  const invokeCommand = useWorldStore(s => s.invokeCommand)
  const runProgramAction = useWorldStore(s => s.runProgram)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)

  const cmd = (command: string) => () => invokeCommand(computerId, command)
  const runProgram = (name: string) => () => runProgramAction(computerId, name)

  return (
    <div className="group">
      <div className="btn-row-3">
        <button className="btn btn-compact" onClick={cmd('down')}>Down <kbd className="kbd">Q</kbd></button>
        <button className="btn btn-compact" onClick={cmd('forward')}>Forward <kbd className="kbd">W</kbd></button>
        <button className="btn btn-compact" onClick={cmd('up')}>Up <kbd className="kbd">E</kbd></button>
        <button className="btn btn-compact" onClick={cmd('left')}>Turn L <kbd className="kbd">A</kbd></button>
        <button className="btn btn-compact" onClick={cmd('back')}>Back <kbd className="kbd">S</kbd></button>
        <button className="btn btn-compact" onClick={cmd('right')}>Turn R <kbd className="kbd">D</kbd></button>
      </div>

      <div className="btn-row-3">
        <button className="btn btn-compact" onClick={cmd('digDown')}>Dig Down</button>
        <button className="btn btn-compact" onClick={cmd('dig')}>Dig</button>
        <button className="btn btn-compact" onClick={cmd('digUp')}>Dig Up</button>
        <button className="btn btn-compact" onClick={cmd('placeDown')}>Place Dn</button>
        <button className="btn btn-compact" onClick={cmd('place')}>Place</button>
        <button className="btn btn-compact" onClick={cmd('placeUp')}>Place Up</button>
        <button className="btn btn-compact" onClick={cmd('dropDown')}>Drop Dn</button>
        <button className="btn btn-compact" onClick={cmd('drop')}>Drop</button>
        <button className="btn btn-compact" onClick={cmd('dropUp')}>Drop Up</button>
      </div>

      <div className="btn-row-3">
        <button className="btn btn-compact" onClick={runProgram('veinMiner')}>Mine Vein</button>
        <button className="btn btn-compact" onClick={runProgram('treeMiner')}>Mine Tree</button>
        <button className="btn btn-compact" onClick={cmd('craft')}>Craft</button>
        <button className="btn btn-compact" onClick={cmd('suckAll')}>Suck All</button>
        <button className="btn btn-compact" onClick={cmd('refuel')}>Refuel</button>
        <button className="btn btn-compact" onClick={runProgram('skynetExpander')}>New Turtle</button>
      </div>
    </div>
  )
}
