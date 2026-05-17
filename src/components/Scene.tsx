'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Block } from '@/types/world'
import { useWorldStore, lookupBlock, worldDataLen } from '@/store/useWorld'
import { useWorldViewStore, clearMaterialsCache } from '@/store/useWorldView'
import { ChunkManager } from '@/utils/rendering/ChunkManager'
import { CHUNK_SIZE } from '@/utils/rendering/WorldChunk'
import RideAlongSettingsModal from './RideAlongSettingsModal'

class TextureAnimator {
  texture: THREE.Texture
  tileDurationMillis: number
  tilesHorizontal: number
  tilesVertical: number
  numberOfTiles: number
  currentDisplayMillis = 0
  currentTile = 0
  forward = true

  constructor(texture: THREE.Texture, tileDurationMillis: number) {
    this.texture = texture
    this.tileDurationMillis = tileDurationMillis
    this.tilesHorizontal = 1
    const img = texture.image as { height: number; width: number }
    this.tilesVertical = img.height / img.width
    this.numberOfTiles = this.tilesHorizontal * this.tilesVertical
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1 / this.tilesHorizontal, 1 / this.tilesVertical)
  }

  update(milliSec: number) {
    this.currentDisplayMillis += milliSec
    while (this.currentDisplayMillis > this.tileDurationMillis) {
      this.currentDisplayMillis -= this.tileDurationMillis
      this.currentTile += this.forward ? 1 : -1
      if (this.currentTile === this.numberOfTiles - 1 || this.currentTile === 0)
        this.forward = !this.forward
      this.texture.offset.x = (this.currentTile % this.tilesHorizontal) / this.tilesHorizontal
      this.texture.offset.y = Math.floor(this.currentTile / this.tilesHorizontal) / this.tilesVertical
    }
  }
}

// ─── Inner component — runs inside the R3F Canvas context ─────────────────────

function SceneSetup() {
  const { scene, camera, gl, invalidate } = useThree()
  const controlsRef = useRef<any>(null)

  // Stable Three.js objects (not stored in Zustand — no re-render needed)
  const blocksGroup = useRef(new THREE.Group())
  const entitiesGroup = useRef(new THREE.Group())
  const invGroup = useRef(new THREE.Group())
  const orbitMarker = useRef(new THREE.AxesHelper(0.75))
  const chunkManager = useRef<ChunkManager | null>(null)
  const raycaster = useRef(new THREE.Raycaster())
  const animatedTextures = useRef<TextureAnimator[]>([])
  const invSprites = useRef(new Map<string, THREE.Sprite>())
  // tracks which locStrings each computer currently has indicators for, so updateComputer can diff them
  const computerAdjInvKeys = useRef(new Map<string, Set<string>>())
  const entityMeshes = useRef<Record<string, THREE.Mesh>>({})
  const entityMats = useRef<Record<string, THREE.MeshPhongMaterial>>({})
  const turtleModel = useRef<THREE.Object3D | null>(null)
  const exclMat = useRef<THREE.SpriteMaterial | null>(null)
  const entityGeom = useRef(new THREE.OctahedronGeometry(0.35))
  const prevViewMatrix = useRef(new THREE.Matrix4())
  const computerAnimTargets = useRef<Record<string, { pos: THREE.Vector3; rot: number }>>({})
  const rideAlongYaw   = useRef<number | null>(null)
  const rideAlongPitch = useRef<number | null>(null)
  const rideAlongId    = useRef<number>(-1)
  const rideSnap = useRef({ cx: 0, cy: 0, cz: 0 })

  const MOVE_SPEED = 10  // blocks per second
  const ROT_SPEED  = Math.PI * 4  // radians per second (~0.125 s per 90°)

  // ─── Camera / chunk helpers ────────────────────────────────────────────────

  function setCameraFocus(target: THREE.Vector3) {
    controlsRef.current?.moveTo(target.x, target.y, target.z, true)
  }

  function focusOnComputer(computerId: number) {
    const computer = useWorldStore.getState().computers[computerId]
    if (!computer?.loc) return
    setCameraFocus(new THREE.Vector3(computer.loc.x, computer.loc.y, computer.loc.z))
  }

  function updateChunkVisibility() {
    const cm = chunkManager.current
    const controls = controlsRef.current
    if (!cm || !controls) return
    const target = new THREE.Vector3()
    controls.getTarget(target)
    const wv = useWorldViewStore.getState()
    orbitMarker.current.position.copy(target)
    orbitMarker.current.visible = wv.showOrbitMarker
    cm.updateVisibility(
      camera as THREE.PerspectiveCamera,
      target,
      wv.renderDistance * CHUNK_SIZE,
      wv.lockChunks,
    )
  }

  // ─── Raycasting ───────────────────────────────────────────────────────────

  function getBlockPosFromHit(hit: THREE.Intersection): THREE.Vector3 {
    const attr = (hit.object as THREE.Mesh).geometry?.getAttribute('blockCoord')
    if (attr) {
      const i = hit.face!.a
      return new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i))
    }
    // Fallback for non-chunk geometry (entity markers, inventory sprites, etc.)
    const worldNormal = hit.face!.normal.clone()
      .transformDirection(hit.object.matrixWorld)
      .round()
    const inside = hit.point.clone().addScaledVector(worldNormal, -0.5)
    return new THREE.Vector3(
      Math.floor(inside.x + 0.5),
      Math.floor(inside.y + 0.5),
      Math.floor(inside.z + 0.5),
    )
  }

  function getGotoBlockPosFromHit(hit: THREE.Intersection): THREE.Vector3 {
    const blockPos = getBlockPosFromHit(hit)
    const worldNormal = hit.face!.normal.clone()
      .transformDirection(hit.object.matrixWorld)
      .round()
    return blockPos.clone().add(worldNormal)
  }

  function raycast(e: MouseEvent) {
    const rect = gl.domElement.getBoundingClientRect()
    const mouse = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    }
    raycaster.current.setFromCamera(mouse as any, camera)

    const entityHits = raycaster.current.intersectObjects(entitiesGroup.current.children, false)
    if (entityHits.length > 0) {
      const mesh = entityHits[0].object as THREE.Mesh
      useWorldViewStore.setState({
        hoveredEntity: (mesh as any).userData.entity,
        hoveredBlock: null,
        hoveredBlockPos: null,
        gotoBlockPos: null,
      })
      return
    }
    useWorldViewStore.setState({ hoveredEntity: null })

    const intersects = raycaster.current.intersectObjects(blocksGroup.current.children, false)
    const wvSnap = useWorldViewStore.getState()
    const rcHiddenAll = new Set<string>()
    const rcHiddenSpecific = new Set<string>()
    for (const h of wvSnap.transparencyList) {
      const parts = h.split(':')
      if (parts.length > 2) {
        const last = parts[parts.length - 1]; const n = parseInt(last, 10)
        if (!isNaN(n) && String(n) === last) { rcHiddenSpecific.add(`${parts.slice(0, -1).join(':')}:${n}`); continue }
      }
      rcHiddenAll.add(h)
    }
    for (const hit of intersects) {
      if (!hit.face) continue
      const blockPos = getBlockPosFromHit(hit)
      const locString = `${blockPos.x},${blockPos.y},${blockPos.z}`
      const block = lookupBlock(locString)
      if (!block) continue
      if (wvSnap.miningMode && (rcHiddenAll.has(block.name) || rcHiddenSpecific.has(`${block.name}:${block.metadata ?? 0}`))) continue
      useWorldViewStore.setState({
        hoveredBlock: block,
        hoveredBlockPos: blockPos,
        gotoBlockPos: getGotoBlockPosFromHit(hit),
      })
      return
    }
    useWorldViewStore.setState({ hoveredBlock: null, hoveredBlockPos: null, gotoBlockPos: null })
  }

  // ─── Inventory indicators ─────────────────────────────────────────────────

  function addInventoryIndicator(locString: string) {
    if (!exclMat.current || invSprites.current.has(locString)) return
    const [x, y, z] = locString.split(',').map(Number)
    const sprite = new THREE.Sprite(exclMat.current)
    sprite.position.set(x, y + 1.4, z)
    sprite.scale.set(0.9, 0.9, 0.9)
    invGroup.current.add(sprite)
    invSprites.current.set(locString, sprite)
  }

  function removeInventoryIndicator(locString: string) {
    const sprite = invSprites.current.get(locString)
    if (sprite) {
      invGroup.current.remove(sprite)
      invSprites.current.delete(locString)
    }
  }

  // ─── Block management ─────────────────────────────────────────────────────

  function addBlock(locString: string, block: Block) {
    if (!useWorldViewStore.getState().isBlockVisible(locString)) return
    chunkManager.current?.addBlock(locString, block)
    // inventory indicators are driven by computer adjacentInventory, not block data
  }

  function removeBlock(locString: string) {
    chunkManager.current?.removeBlock(locString)
  }

  function clearAllBlocks() {
    chunkManager.current?.clearAll()
  }

  // ─── Entity management ────────────────────────────────────────────────────

  function getEntityMaterial(name: string): THREE.MeshPhongMaterial {
    if (!entityMats.current[name]) {
      const mat = new THREE.MeshPhongMaterial({ color: 0xff8800 })
      entityMats.current[name] = mat
      const loader = new THREE.TextureLoader()
      loader.load(
        useWorldStore.getState().assetURL + `entities/${name.replace(':', '/')}.png`,
        (texture) => {
          texture.minFilter = THREE.NearestFilter
          texture.magFilter = THREE.NearestFilter
          mat.map = texture
          mat.color.setHex(0xffffff)
          mat.needsUpdate = true
        },
        undefined,
        () => { /* no texture — keep fallback orange */ }
      )
    }
    return entityMats.current[name]
  }

  function updateEntities(computerId: string) {
    const computer = useWorldStore.getState().computers[computerId]
    const prefix = `${computerId}:`

    // Remove stale meshes for this computer
    for (const key of Object.keys(entityMeshes.current)) {
      if (!key.startsWith(prefix)) continue
      const mesh = entityMeshes.current[key]
      if (mesh?.parent === entitiesGroup.current) entitiesGroup.current.remove(mesh)
      delete entityMeshes.current[key]
    }

    if (!computer?.entities || !computer.loc) return
    const { x: ox, y: oy, z: oz } = computer.loc
    for (const entity of computer.entities) {
      const mesh = new THREE.Mesh(entityGeom.current, getEntityMaterial(entity.name))
      const wx = ox + entity.x, wy = oy + entity.y, wz = oz + entity.z
      mesh.position.set(wx, wy, wz)
      ;(mesh as any).userData.entity = { ...entity, worldPos: new THREE.Vector3(wx, wy, wz) }
      entitiesGroup.current.add(mesh)
      entityMeshes.current[`${prefix}${entity.id}`] = mesh
    }
  }

  // ─── Computer model management ────────────────────────────────────────────

  function addComputer(computerId: string) {
    if (!turtleModel.current) return
    const computerData = useWorldStore.getState().computers[computerId]
    if (!computerData?.loc) return
    const model = turtleModel.current.clone()
    scene.add(model)
    const wv = useWorldViewStore.getState()
    useWorldViewStore.setState({ computerModels: { ...wv.computerModels, [computerId]: model } })
    const { x, y, z } = computerData.loc
    model.position.set(x, y, z)
    if (computerData.type === 'minecart') {
      model.rotation.set(0, 0, 0)
    } else {
      model.rotation.set(Math.PI / 2, 0, ((computerData.rot + 1) * Math.PI) / 2)
    }
  }

  function updateComputer(computerId: string) {
    const wv = useWorldViewStore.getState()
    const model = wv.computerModels[computerId]
    if (!model) { addComputer(computerId); return }
    const computerData = useWorldStore.getState().computers[computerId]
    if (!computerData?.loc) return
    if (computerData.type === 'minecart') {
      const { x: newX, y: newY, z: newZ } = computerData.loc
      model.rotation.set(0, 0, 0)
      model.position.set(newX, newY, newZ)
      model.updateMatrix()
    } else {
      // For turtles/stationary computers, animate position and rotation smoothly.
      const { x, y, z } = computerData.loc
      const targetRot = ((computerData.rot + 1) * Math.PI) / 2
      computerAnimTargets.current[computerId] = { pos: new THREE.Vector3(x, y, z), rot: targetRot }
      invalidate()
    }

    // Sync inventory indicators: diff old vs new adjacentInventory for this computer.
    const allComputers = useWorldStore.getState().computers
    const newAdjInv = (computerData as any).adjacentInventory ?? {}
    const newKeys = new Set<string>(Object.keys(newAdjInv))
    const oldKeys = computerAdjInvKeys.current.get(computerId) ?? new Set<string>()
    for (const loc of oldKeys) {
      if (!newKeys.has(loc)) {
        const stillNeeded = Object.entries(allComputers).some(
          ([id, c]) => id !== computerId && (c as any).adjacentInventory?.[loc]
        )
        if (!stillNeeded) removeInventoryIndicator(loc)
      }
    }
    for (const loc of newKeys) {
      if (!oldKeys.has(loc)) addInventoryIndicator(loc)
    }
    computerAdjInvKeys.current.set(computerId, newKeys)
  }

  function removeComputerModel(computerId: string) {
    const wv = useWorldViewStore.getState()
    const model = wv.computerModels[computerId]
    if (!model) return
    scene.remove(model)
    const updated = { ...wv.computerModels }
    delete updated[computerId]
    useWorldViewStore.setState({ computerModels: updated })
  }

  // ─── Animated textures ────────────────────────────────────────────────────

  function addAnimatedTexture(texture: THREE.Texture) {
    animatedTextures.current.push(new TextureAnimator(texture, 1000 / 8))
  }

  // ─── Full scene regeneration ──────────────────────────────────────────────

  async function regenerateSceneFromBlocks() {
    // Yield before touching the scene so the browser can finish any in-progress
    // render frame before we start heavy synchronous work (scene clear, etc.).
    await new Promise<void>(r => setTimeout(r, 0))

    const world = useWorldStore.getState()
    const wv = useWorldViewStore.getState()

    // Snapshot children arrays before removal (live arrays shift during remove)
    scene.remove(...[...scene.children])
    blocksGroup.current.remove(...[...blocksGroup.current.children])
    entitiesGroup.current.remove(...[...entitiesGroup.current.children])
    invGroup.current.remove(...[...invGroup.current.children])
    invSprites.current.clear()
    entityMeshes.current = {}
    computerAnimTargets.current = {}
    useWorldViewStore.setState({ computerModels: {} })

    // Lighting
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.5)
    dir1.position.set(1, 2, 3)
    scene.add(dir1)
    const dir2 = new THREE.DirectionalLight(0x888888, 1)
    dir2.position.set(-1, -2, -3)
    scene.add(dir2)
    scene.add(new THREE.AmbientLight(0xffffff, 0.4))

    clearMaterialsCache()
    if (chunkManager.current) chunkManager.current.dispose()
    chunkManager.current = new ChunkManager(blocksGroup.current, wv.fastRender, () => invalidate())

    scene.add(blocksGroup.current)
    scene.add(entitiesGroup.current)
    scene.add(invGroup.current)
    scene.add(orbitMarker.current)

    if (wv.selectedComputerId !== -1) focusOnComputer(wv.selectedComputerId)

    // Build a fast visibility closure from a single state snapshot so bulkLoad
    // doesn't call getState()/require on every block in the world.
    const { yMin, yMax, transparencyList, miningMode } = wv
    const hiddenAllMeta = new Set<string>()
    const hiddenSpecificMeta = new Set<string>()
    for (const h of transparencyList) {
      const parts = h.split(':')
      if (parts.length > 2) {
        const last = parts[parts.length - 1]
        const n = parseInt(last, 10)
        if (!isNaN(n) && String(n) === last) { hiddenSpecificMeta.add(`${parts.slice(0, -1).join(':')}:${n}`); continue }
      }
      hiddenAllMeta.add(h)
    }
    const isHiddenByFilter = (name: string, meta: number | undefined) =>
      hiddenAllMeta.has(name) || hiddenSpecificMeta.has(`${name}:${meta ?? 0}`)
    const isVisible = (locString: string): boolean => {
      const c1 = locString.indexOf(',')
      const c2 = locString.indexOf(',', c1 + 1)
      const y = +locString.slice(c1 + 1, c2)
      if (y < yMin || y > yMax) return false
      if (!miningMode) {
        const b = lookupBlock(locString)
        if (b && isHiddenByFilter(b.name, b.metadata)) return false
      }
      return true
    }

    await chunkManager.current.bulkLoad(isVisible, wv.skipLoadYield)

    updateChunkVisibility()

    computerAdjInvKeys.current.clear()
    for (const [id, computer] of Object.entries(world.computers)) {
      const adjInv = (computer as any).adjacentInventory ?? {}
      const keys = new Set<string>(Object.keys(adjInv))
      computerAdjInvKeys.current.set(id, keys)
      for (const loc of keys) addInventoryIndicator(loc)
    }

    for (const computerId in world.computers) {
      addComputer(computerId)
      updateEntities(computerId)
    }
  }

  // ─── Mount / unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    // Load turtle model
    new GLTFLoader().load(
      'assets/turtle/CCTurtle_happy.glb',
      (gltf) => { turtleModel.current = gltf.scene },
      undefined,
      (e) => console.error(e),
    )

    // Build exclamation sprite material using canvas
    const exclCanvas = document.createElement('canvas')
    exclCanvas.width = 64; exclCanvas.height = 64
    const ctx = exclCanvas.getContext('2d')!
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 52px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('!', 32, 34)
    exclMat.current = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(exclCanvas),
      depthTest: false,
    })

    orbitMarker.current.visible = false

    // DOM event listeners on the WebGL canvas
    const domEl = gl.domElement

    const handleClick = (e: MouseEvent) => {
      if (useWorldViewStore.getState().blockPickMode) {
        raycast(e)
        const wv = useWorldViewStore.getState()
        if (wv.hoveredBlock) {
          const b = wv.hoveredBlock
          const filterKey = b.metadata !== undefined ? `${b.name}:${b.metadata}` : b.name
          useWorldViewStore.getState().addPendingFilterBlock(filterKey)
        }
        return
      }
      raycast(e)
      const wv = useWorldViewStore.getState()
      if (wv.hoveredEntity) {
        useWorldViewStore.setState({ selectedInventoryPos: null })
      } else if (wv.hoveredBlockPos) {
        const pos = wv.hoveredBlockPos
        const locStr = `${pos.x},${pos.y},${pos.z}`
        const computers = useWorldStore.getState().computers
        const hasInv = Object.values(computers).some(c => (c as any).adjacentInventory?.[locStr])
        useWorldViewStore.setState({
          selectedInventoryPos: hasInv ? { x: pos.x, y: pos.y, z: pos.z } : null,
        })
      } else {
        useWorldViewStore.setState({ selectedInventoryPos: null })
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useWorldViewStore.getState().blockPickMode) {
        useWorldViewStore.getState().cancelPendingFilterBlocks()
      }
    }

    const handleDblClick = (e: MouseEvent) => {
      raycast(e)
      const wv = useWorldViewStore.getState()
      if (!wv.selectedComputerId || wv.selectedComputerId === -1 || !wv.gotoBlockPos) return
      const loc = wv.gotoBlockPos
      useWorldStore.getState().invokeCommand(wv.selectedComputerId, 'goTo', [loc.x, loc.y, loc.z])
    }

    let lastMouseMove = 0
    const handleMouseMove = (e: MouseEvent) => {
      if (useWorldViewStore.getState().lockBlockInfo) return
      const now = performance.now()
      if (now - lastMouseMove < 33) return
      lastMouseMove = now
      raycast(e)
    }

    domEl.addEventListener('mousemove', handleMouseMove)
    domEl.addEventListener('click', handleClick)
    domEl.addEventListener('dblclick', handleDblClick)
    document.addEventListener('keydown', handleKeyDown)

    // Register all worldView store callbacks so other stores can drive the scene
    useWorldViewStore.setState({
      regenerateSceneFromBlocks,
      render: () => invalidate(),
      setCameraFocus,
      focusOnComputer,
      addBlock,
      removeBlock,
      clearAllBlocks,
      updateComputer,
      updateEntities,
      removeComputerModel,
      addAnimatedTexture,
      updateChunkVisibility,
    })

    // IDB cache may have resolved before R3F mounted (IDB fires as a macrotask,
    // R3F registers callbacks on its first requestAnimationFrame — which comes
    // after DOM effects).  If worldData is already populated, the
    // regenerateSceneFromBlocks() call in the cache handler hit the no-op
    // placeholder.  Catch up now that the real function is registered.
    if (worldDataLen > 0) {
      regenerateSceneFromBlocks()
      invalidate()
    }

    return () => {
      domEl.removeEventListener('mousemove', handleMouseMove)
      domEl.removeEventListener('click', handleClick)
      domEl.removeEventListener('dblclick', handleDblClick)
      document.removeEventListener('keydown', handleKeyDown)
      chunkManager.current?.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Animation loop ────────────────────────────────────────────────────────

  useFrame((state, delta) => {
    const wv = useWorldViewStore.getState()

    // ── Ride-along: first-person camera locked to player yaw/pitch ──────────
    const rideId = wv.rideAlongComputerId
    if (rideId !== -1) {
      const comp = useWorldStore.getState().computers[rideId]
      if (comp?.loc) {
        const { x, y, z } = comp.loc
        const snap = rideSnap.current

        // Reset all smoothed values when switching computers.
        if (rideAlongId.current !== rideId) {
          rideAlongId.current    = rideId
          rideAlongYaw.current   = comp.yaw   ?? 0
          rideAlongPitch.current = comp.pitch ?? 0
          snap.cx = x; snap.cy = y; snap.cz = z
        }

        // Low-rate exponential lerp: rate 3 covers ~78% of the distance in 0.5 s,
        // so the camera is always still moving when the next update arrives — no freeze.
        const posT = Math.min(1, 3 * delta)
        snap.cx += (x - snap.cx) * posT
        snap.cy += (y - snap.cy) * posT
        snap.cz += (z - snap.cz) * posT
        const sx = snap.cx, sy = snap.cy, sz = snap.cz

        // Yaw/pitch: same rate, shortest angular path.
        const targetYaw   = comp.yaw   ?? rideAlongYaw.current!
        const targetPitch = comp.pitch ?? rideAlongPitch.current!
        let yawDiff   = targetYaw   - rideAlongYaw.current!
        let pitchDiff = targetPitch - rideAlongPitch.current!
        if (yawDiff >  180) yawDiff -= 360
        if (yawDiff < -180) yawDiff += 360
        const angT = Math.min(1, 3 * delta)
        rideAlongYaw.current!   += yawDiff   * angT
        rideAlongPitch.current! += pitchDiff * angT

        // Blocks are placed with their corner at the integer coordinate, so GPS floats
        // are already in the same space — but the player's body centre sits at +0.5 in
        // each axis relative to the block corner, which the chunk renderer doesn't add.
        const camX = sx - 0.5
        const camZ = sz - 0.5
        const eyeY = sy - 0.5
        // Minecraft yaw: 0=South(+Z), 90=West(-X), 180=North(-Z), 270=East(+X)
        const yawRad   = rideAlongYaw.current!   * Math.PI / 180
        const pitchRad = rideAlongPitch.current! * Math.PI / 180
        const lookDist = 20
        const lx = camX - lookDist * Math.sin(yawRad) * Math.cos(pitchRad)
        const ly = eyeY  - lookDist * Math.sin(pitchRad)
        const lz = camZ  + lookDist * Math.cos(yawRad) * Math.cos(pitchRad)
        controlsRef.current?.setLookAt(camX, eyeY, camZ, lx, ly, lz, false)
        const cam = state.camera as THREE.PerspectiveCamera
        const targetFov = wv.rideAlongFov
        if (cam.fov !== targetFov || cam.near !== 0.05) {
          cam.fov = targetFov; cam.near = 0.05; cam.updateProjectionMatrix()
        }
        if (controlsRef.current) controlsRef.current.enabled = false
        state.invalidate()
      }
    } else {
      rideAlongId.current = -1
      if (controlsRef.current && !controlsRef.current.enabled) {
        controlsRef.current.enabled = true
      }
      const cam = state.camera as THREE.PerspectiveCamera
      if (cam.fov !== 45 || cam.near !== 1) { cam.fov = 45; cam.near = 1; cam.updateProjectionMatrix() }
    }

    // ── Follow: 3rd-person orbit target tracks computer position ────────────
    const computerId = wv.followedComputer.computerId
    if (computerId !== -1) {
      const currPos = useWorldStore.getState().computers[computerId]?.loc
      const lastPos = wv.followedComputer.lastPos
      if (currPos && lastPos &&
        (currPos.x !== lastPos.x || currPos.y !== lastPos.y || currPos.z !== lastPos.z)) {
        setCameraFocus(new THREE.Vector3(currPos.x, currPos.y, currPos.z))
        useWorldViewStore.setState(s => ({ followedComputer: { ...s.followedComputer, lastPos: currPos } }))
      }
    }

    if (animatedTextures.current.length > 0) {
      for (const anim of animatedTextures.current) {
        anim.update(delta * 1000)
      }
      state.invalidate()
    }

    // Smooth computer movement: lerp each model toward its target pos/rot.
    const targets = computerAnimTargets.current
    const models = wv.computerModels
    let anyMoving = false
    for (const id of Object.keys(targets)) {
      const model = models[id]
      if (!model) { delete targets[id]; continue }
      const { pos, rot } = targets[id]

      const dist = model.position.distanceTo(pos)
      let diff = rot - model.rotation.z
      // Take the shortest angular path.
      if (diff >  Math.PI) diff -= 2 * Math.PI
      if (diff < -Math.PI) diff += 2 * Math.PI

      const posClose = dist   < 0.005
      const rotClose = Math.abs(diff) < 0.005

      if (posClose && rotClose) {
        model.position.copy(pos)
        model.rotation.z = rot
        model.updateMatrix()
        delete targets[id]
      } else {
        if (!posClose) model.position.lerp(pos, Math.min(dist, MOVE_SPEED * delta) / dist)
        if (!rotClose) model.rotation.z += Math.min(Math.abs(diff), ROT_SPEED * delta) * Math.sign(diff)
        model.updateMatrix()
        anyMoving = true
      }
    }
    if (anyMoving) state.invalidate()

    // Apply pending chunk GPU uploads within a per-frame budget.  Running this
    // inside useFrame (rather than setTimeout) ensures input events and camera
    // rotation are never blocked mid-frame by chunk work.
    chunkManager.current?.flushFrame(4);

    // Only recalculate chunk visibility when the camera has actually moved.
    state.camera.updateMatrixWorld()
    if (!state.camera.matrixWorldInverse.equals(prevViewMatrix.current)) {
      prevViewMatrix.current.copy(state.camera.matrixWorldInverse)
      updateChunkVisibility()
    }
  })

  return (
    <>
      <color attach="background" args={['#111318']} />
      <CameraControls ref={controlsRef} makeDefault />
    </>
  )
}

// ─── Public export — renders the R3F Canvas ───────────────────────────────────

export default memo(function Scene() {
  const blockPickMode   = useWorldViewStore(s => s.blockPickMode)
  const rideAlongAspect = useWorldViewStore(s => s.rideAlongAspect)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let downX = 0, downY = 0
    const onDown = (e: PointerEvent) => {
      if (e.button !== 2) return
      downX = e.clientX; downY = e.clientY
      if (useWorldViewStore.getState().rideAlongComputerId !== -1) e.stopPropagation()
    }
    const onMenu = (e: MouseEvent) => {
      if (useWorldViewStore.getState().rideAlongComputerId === -1) return
      e.preventDefault()
      const dx = e.clientX - downX, dy = e.clientY - downY
      if (dx * dx + dy * dy > 25) return  // was a drag
      setSettingsOpen(true)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('contextmenu', onMenu, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('contextmenu', onMenu, true)
    }
  }, [])

  // Fit the canvas to the target aspect ratio inside the container (letterbox/pillarbox).
  // When no aspect is locked, fill the container normally.
  let canvasStyle: React.CSSProperties = { position: 'absolute', inset: 0, cursor: blockPickMode ? 'crosshair' : 'default' }
  if (rideAlongAspect && containerSize.w > 0 && containerSize.h > 0) {
    const cw = containerSize.w, ch = containerSize.h
    let w: number, h: number
    if (rideAlongAspect > cw / ch) { w = cw; h = cw / rideAlongAspect }
    else                            { h = ch; w = ch * rideAlongAspect }
    canvasStyle = {
      position: 'absolute',
      left: (cw - w) / 2, top: (ch - h) / 2,
      width: w, height: h,
      cursor: blockPickMode ? 'crosshair' : 'default',
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, background: '#111318' }}>
      <Canvas
        frameloop="demand"
        style={canvasStyle}
        camera={{ fov: 45, near: 1, far: 10000, position: [-4, 5, -10] }}
      >
        <SceneSetup />
      </Canvas>
      {settingsOpen && <RideAlongSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
})
