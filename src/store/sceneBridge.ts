import * as THREE from 'three'
import type { Block } from '../types/world'

type SceneCallback<T extends unknown[] = []> = (...args: T) => void

export interface SceneBridge {
  regenerateSceneFromBlocks: SceneCallback
  render: SceneCallback
  setCameraFocus: SceneCallback<[THREE.Vector3]>
  focusOnComputer: SceneCallback<[number]>
  addBlock: SceneCallback<[string, Block]>
  removeBlock: SceneCallback<[string]>
  clearAllBlocks: SceneCallback
  updateComputer: SceneCallback<[string]>
  updateEntities: SceneCallback<[string]>
  removeComputerModel: SceneCallback<[string]>
  addAnimatedTexture: SceneCallback<[THREE.Texture]>
  updateChunkVisibility: SceneCallback
}

export const sceneBridge: SceneBridge = {
  regenerateSceneFromBlocks: () => {},
  render: () => {},
  setCameraFocus: () => {},
  focusOnComputer: () => {},
  addBlock: () => {},
  removeBlock: () => {},
  clearAllBlocks: () => {},
  updateComputer: () => {},
  updateEntities: () => {},
  removeComputerModel: () => {},
  addAnimatedTexture: () => {},
  updateChunkVisibility: () => {},
}
