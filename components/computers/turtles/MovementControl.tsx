'use client'

import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'
import { btn, colors } from '../computerStyles'

interface Props { computerId: number }

// Percentage padding keeps buttons square regardless of panel width
const padBtn = { ...btn, padding: '10% 0', borderRadius: 4 }
const padActiveBtn = { ...padBtn, backgroundColor: colors.activeBg, color: colors.activeText }

export default function MovementControl({ computerId }: Props) {
  const sendCommand = useWorldStore(s => s.sendCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)
  const focusOnComputer = useWorldViewStore(s => s.focusOnComputer)
  const followComputer = useWorldViewStore(s => s.followComputer)
  const followedComputer = useWorldViewStore(s => s.followedComputer)

  const isFollowing = followedComputer.computerId === computerId
  const cmd = (c: string) => () => sendCommand(computerId, c)
  const runProgram = (name: string) => async () => {
    const code = await fetch(`/turtlePrograms/${name}.lua`).then(r => r.text())
    sendCommand(computerId, code)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
      <button style={padBtn} onClick={cmd('return tapi.down()')}>Down (q)</button>
      <button style={padBtn} onClick={cmd('return tapi.forward()')}>Forward (w)</button>
      <button style={padBtn} onClick={cmd('return tapi.up()')}>Up (e)</button>
      <button style={padBtn} onClick={cmd('return tapi.left()')}>Turn Left (a)</button>
      <button style={padBtn} onClick={cmd('return tapi.back()')}>Back (s)</button>
      <button style={padBtn} onClick={cmd('return tapi.right()')}>Turn Right (d)</button>
      <button style={padBtn} onClick={cmd('return tapi.suckAll()')}>Suck All</button>
      <button style={padBtn} onClick={() => focusOnComputer(computerId)}>Focus Camera</button>
      <button style={isFollowing ? padActiveBtn : padBtn} onClick={() => followComputer(computerId)}>Toggle Follow</button>
      <button style={padBtn} onClick={cmd('return tapi.digDown()')}>Dig Down</button>
      <button style={padBtn} onClick={cmd('return tapi.dig()')}>Dig</button>
      <button style={padBtn} onClick={cmd('return tapi.digUp()')}>Dig Up</button>
      <button style={padBtn} onClick={cmd('return tapi.placeDown()')}>Place Down</button>
      <button style={padBtn} onClick={cmd('return tapi.place()')}>Place</button>
      <button style={padBtn} onClick={cmd('return tapi.placeUp()')}>Place Up</button>
      <button style={padBtn} onClick={cmd('return tapi.dropDown()')}>Drop Down</button>
      <button style={padBtn} onClick={cmd('return tapi.drop()')}>Drop</button>
      <button style={padBtn} onClick={cmd('return tapi.dropUp()')}>Drop Up</button>
      <button style={padBtn} onClick={runProgram('veinMiner')}>Mine Vein</button>
      <button style={padBtn} onClick={runProgram('treeMiner')}>Mine Tree</button>
      <button style={padBtn} onClick={cmd('return tapi.craft()')}>Craft</button>
      <button style={padBtn} onClick={cmd('return tapi.refuel()')}>Refuel</button>
      <button style={padBtn} onClick={() => sendStopSignal(computerId)}>🛑 Stop 🛑</button>
      <button style={padBtn} onClick={runProgram('skynetExpander')}>New Turtle</button>
    </div>
  )
}
