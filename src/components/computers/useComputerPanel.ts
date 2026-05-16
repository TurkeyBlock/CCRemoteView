import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore } from '@/store/useWorldView'

export function useComputerPanel(computerId: number) {
  const invokeCommand  = useWorldStore(s => s.invokeCommand)
  const sendStopSignal = useWorldStore(s => s.sendStopSignal)

  const focusOnComputer    = useWorldViewStore(s => s.focusOnComputer)
  const followComputer     = useWorldViewStore(s => s.followComputer)
  const isFollowing        = useWorldViewStore(s => s.followedComputer.computerId === computerId)
  const rideAlongComputer  = useWorldViewStore(s => s.rideAlongComputer)
  const isRideAlong        = useWorldViewStore(s => s.rideAlongComputerId === computerId)
  const setLiveView        = useWorldViewStore(s => s.setLiveView)
  const isLiveView         = useWorldViewStore(s => s.liveViewComputerId === computerId)

  return { invokeCommand, sendStopSignal, focusOnComputer, followComputer, isFollowing, rideAlongComputer, isRideAlong, setLiveView, isLiveView }
}
