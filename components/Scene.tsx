'use client'

import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Block } from '@/types/types'
import { useWorldStore } from '@/store/useWorld'
import { useWorldViewStore, clearMaterialsCache } from '@/store/useWorldView'
import { ChunkManager } from '@/utils/ChunkManager'
import { CHUNK_SIZE } from '@/utils/WorldChunk'

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
  const entityMeshes = useRef<Record<string, THREE.Mesh>>({})
  const entityMats = useRef<Record<string, THREE.MeshPhongMaterial>>({})
  const turtleModel = useRef<THREE.Object3D | null>(null)
  const exclMat = useRef<THREE.SpriteMaterial | null>(null)
  const entityGeom = useRef(new THREE.OctahedronGeometry(0.35))
  const prevViewMatrix = useRef(new THREE.Matrix4())
  const computerAnimTargets = useRef<Record<string, { pos: THREE.Vector3; rot: number }>>({})

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
    const mouse = {
      x: (e.clientX / window.innerWidth) * 2 - 1,
      y: -(e.clientY / window.innerHeight) * 2 + 1,
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
    for (const hit of intersects) {
      if (!hit.face) continue
      const blockPos = getBlockPosFromHit(hit)
      const locString = `${blockPos.x},${blockPos.y},${blockPos.z}`
      const block = useWorldStore.getState().blocks[locString]
      if (!block) continue
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
    sprite.position.set(x, y + 0.9, z)
    sprite.scale.set(0.5, 0.5, 0.5)
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
    if (block.inventory) addInventoryIndicator(locString)
    else removeInventoryIndicator(locString)
  }

  function removeBlock(locString: string) {
    chunkManager.current?.removeBlock(locString)
    removeInventoryIndicator(locString)
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
        useWorldStore.getState().textureURL + `entities/${name.replace(':', '/')}.png`,
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
      chunkManager.current?.removeBlock(`${x},${y},${z}`)
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
      // Minecarts swap world blocks at integer positions, so move them immediately.
      const oldX = Math.round(model.position.x)
      const oldY = Math.round(model.position.y)
      const oldZ = Math.round(model.position.z)
      const { x: newX, y: newY, z: newZ } = computerData.loc
      if (oldX !== newX || oldY !== newY || oldZ !== newZ) {
        const oldLoc = `${oldX},${oldY},${oldZ}`
        const oldBlock = useWorldStore.getState().blocks[oldLoc]
        if (oldBlock && wv.isBlockVisible(oldLoc)) chunkManager.current?.addBlock(oldLoc, oldBlock)
        chunkManager.current?.removeBlock(`${newX},${newY},${newZ}`)
      }
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
    const { yMin, yMax, transparencyList, computerRangeXZ, selectedComputerId, manualCenter } = wv
    const transparencySet = new Set(transparencyList)
    const minecartLocs = new Set<string>()
    for (const id in world.computers) {
      const c = world.computers[id]
      if (c.type === 'minecart' && c.loc) minecartLocs.add(`${c.loc.x},${c.loc.y},${c.loc.z}`)
    }
    let centerX: number | null = null, centerZ: number | null = null
    if (computerRangeXZ !== null) {
      if (selectedComputerId !== -1) {
        const turtle = world.computers[selectedComputerId]
        if (turtle?.loc) { centerX = turtle.loc.x; centerZ = turtle.loc.z }
      } else if (manualCenter) {
        centerX = manualCenter.x; centerZ = manualCenter.z
      }
    }
    const blockSnap = world.blocks
    const isVisible = (locString: string): boolean => {
      const c1 = locString.indexOf(',')
      const c2 = locString.indexOf(',', c1 + 1)
      const y = +locString.slice(c1 + 1, c2)
      if (y < yMin || y > yMax) return false
      if (transparencySet.has(blockSnap[locString]?.name)) return false
      if (minecartLocs.has(locString)) return false
      if (computerRangeXZ !== null && centerX !== null && centerZ !== null) {
        const x = +locString.slice(0, c1)
        const z = +locString.slice(c2 + 1)
        if (Math.abs(x - centerX) > computerRangeXZ || Math.abs(z - centerZ) > computerRangeXZ) return false
      }
      return true
    }

    await chunkManager.current.bulkLoad(world.blocks, isVisible, wv.skipLoadYield)

    updateChunkVisibility()

    for (const locString in world.blocks) {
      if (world.blocks[locString].inventory) addInventoryIndicator(locString)
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
      'textures/turtle/CCTurtle_happy.glb',
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
      raycast(e)
      const wv = useWorldViewStore.getState()
      if (wv.hoveredEntity) {
        useWorldViewStore.setState({ selectedInventory: null, selectedInventorySize: 0 })
      } else if (wv.hoveredBlock?.inventory) {
        useWorldViewStore.setState({
          selectedInventory: wv.hoveredBlock.inventory,
          selectedInventorySize: wv.hoveredBlock.inventorySize as number,
          selectedInventoryPos: wv.hoveredBlockPos ? { x: wv.hoveredBlockPos.x, y: wv.hoveredBlockPos.y, z: wv.hoveredBlockPos.z } : null,
        })
      } else {
        useWorldViewStore.setState({ selectedInventory: null, selectedInventorySize: 0 })
      }
    }

    const handleDblClick = (e: MouseEvent) => {
      raycast(e)
      const wv = useWorldViewStore.getState()
      if (!wv.selectedComputerId || wv.selectedComputerId === -1 || !wv.gotoBlockPos) return
      const loc = wv.gotoBlockPos
      useWorldStore.getState().sendCommand(
        wv.selectedComputerId,
        `tapi.goTo(${loc.x},${loc.y},${loc.z})`,
      )
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

    return () => {
      domEl.removeEventListener('mousemove', handleMouseMove)
      domEl.removeEventListener('click', handleClick)
      domEl.removeEventListener('dblclick', handleDblClick)
      chunkManager.current?.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Animation loop ────────────────────────────────────────────────────────

  useFrame((state, delta) => {
    const wv = useWorldViewStore.getState()
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

export default function Scene() {
  return (
    <Canvas
      frameloop="demand"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
      camera={{ fov: 45, near: 1, far: 10000, position: [-4, 5, -10] }}
    >
      <SceneSetup />
    </Canvas>
  )
}
