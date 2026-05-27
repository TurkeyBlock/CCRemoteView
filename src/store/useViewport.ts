import { create } from 'zustand'
import * as THREE from 'three'
import type { Block, EntitySighting } from '../types/world'
import { useWorldStore } from './useWorld'
import { sceneBridge } from './sceneBridge'

interface ViewportState {
  followedComputer: { computerId: number; lastPos: { x: number; y: number; z: number } }
  rideAlongComputerId: number
  rideAlongFov: number
  rideAlongAspect: number | null
  liveViewComputerId: number
  selectedComputerId: number
  hoveredBlock: Block | null
  hoveredBlockPos: THREE.Vector3 | null
  hoveredEntity: (EntitySighting & { worldPos: THREE.Vector3 }) | null
  gotoBlockPos: THREE.Vector3 | null
  selectedInventoryPos: { x: number; y: number; z: number } | null
  renderDistance: number
  fastRender: boolean
  skipLoadYield: boolean
  lockChunks: boolean
  showOrbitMarker: boolean
  lockBlockInfo: boolean
  simpleOcclusion: boolean

  setSelectedComputerId: (id: number) => void
  followComputer: (computerId: number) => void
  rideAlongComputer: (computerId: number) => void
  setRideAlongSettings: (fov: number, aspect: number | null) => void
  setLiveView: (computerId: number) => void
}

export const useViewportStore = create<ViewportState>()((set, get) => ({
  followedComputer: { computerId: -1, lastPos: { x: 0, y: 0, z: 0 } },
  rideAlongComputerId: -1,
  rideAlongFov: 70,
  rideAlongAspect: null,
  liveViewComputerId: -1,
  selectedComputerId: -1,
  hoveredBlock: null,
  hoveredBlockPos: null,
  hoveredEntity: null,
  gotoBlockPos: null,
  selectedInventoryPos: null,
  renderDistance: 12,
  fastRender: false,
  skipLoadYield: false,
  lockChunks: false,
  showOrbitMarker: false,
  lockBlockInfo: true,
  simpleOcclusion: false,

  setSelectedComputerId: (id) => set({ selectedComputerId: id }),

  setRideAlongSettings: (fov, aspect) => set({ rideAlongFov: fov, rideAlongAspect: aspect }),

  followComputer: (computerId) => {
    const current = get().followedComputer.computerId
    const nextId = current === computerId ? -1 : computerId
    set((s) => ({ followedComputer: { ...s.followedComputer, computerId: nextId }, rideAlongComputerId: -1 }))
    if (nextId === -1) return
    const loc = useWorldStore.getState().computers[computerId]?.loc
    if (loc) {
      set((s) => ({ followedComputer: { ...s.followedComputer, lastPos: loc } }))
      sceneBridge.focusOnComputer(computerId)
    }
  },

  rideAlongComputer: (computerId) => {
    const nextId = get().rideAlongComputerId === computerId ? -1 : computerId
    set((s) => ({
      rideAlongComputerId: nextId,
      followedComputer: { ...s.followedComputer, computerId: -1 },
      // Exiting ride-along also exits live-view (live-view requires ride-along)
      liveViewComputerId: nextId === -1 ? -1 : s.liveViewComputerId,
      // Reset camera settings when leaving ride-along
      ...(nextId === -1 ? { rideAlongFov: 70, rideAlongAspect: null } : {}),
    }))
    if (nextId === -1) return
    const loc = useWorldStore.getState().computers[computerId]?.loc
    if (loc) sceneBridge.focusOnComputer(computerId)
  },

  setLiveView: (computerId) => {
    const nextId = get().liveViewComputerId === computerId ? -1 : computerId
    set({ liveViewComputerId: nextId })
    if (nextId !== -1) {
      // Activating live-view implies ride-along
      const s = get()
      if (s.rideAlongComputerId !== computerId) s.rideAlongComputer(computerId)
    }
  },
}))
