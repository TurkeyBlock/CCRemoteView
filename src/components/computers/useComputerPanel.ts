import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'

export function useComputerPanel(computerId: number) {
  const computer       = useWorldStore(s => s.computers[computerId])
  const invokeCommand  = useWorldStore(s => s.invokeCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)

  const focusOnComputer = useWorldViewStore(s => s.focusOnComputer)
  const followComputer  = useWorldViewStore(s => s.followComputer)
  const isFollowing     = useWorldViewStore(s => s.followedComputer.computerId === computerId)

  return { computer, invokeCommand, sendStopSignal, focusOnComputer, followComputer, isFollowing }
}
