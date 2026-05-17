import * as THREE from 'three'

const models = new Map<string, THREE.Object3D>()

export const computerModelCache = {
  get: (id: string) => models.get(id),
  set: (id: string, model: THREE.Object3D) => models.set(id, model),
  delete: (id: string) => models.delete(id),
  clear: () => models.clear(),
  entries: () => models.entries(),
  values: () => models.values(),
}
