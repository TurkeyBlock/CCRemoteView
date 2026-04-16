import { InstancedMesh, Matrix4, Sphere, Vector3 } from "three";
import { Block } from "../types/types";

class DynamicInstancedMesh extends InstancedMesh {
  maxInstanceCount: number;
  locStringToInstance = new BidirectionalMap({});

  // Conservative bounding box — expands when blocks are added, resets only
  // when the mesh is emptied. Never shrinks on individual removes, so the
  // sphere may be slightly oversized after removals but never incorrectly
  // hides visible geometry (too-large sphere = renders when it shouldn't,
  // which is harmless; too-small = culls when it shouldn't, which is wrong).
  private _bmin = new Vector3(Infinity, Infinity, Infinity);
  private _bmax = new Vector3(-Infinity, -Infinity, -Infinity);

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, maxInstanceCount = 16) {
    // Clone geometry so each mesh owns its own boundingSphere without
    // affecting the shared geometry used by other meshes.
    // BufferGeometry.clone() shallow-copies — buffer data (vertices, UVs, etc.)
    // is still shared, so this is cheap.
    super(geometry.clone(), material, maxInstanceCount);
    this.maxInstanceCount = maxInstanceCount;
    this.count = 0;
    this.frustumCulled = true;
    // Start with an empty sphere (radius 0). Three.js uses this directly when
    // non-null, so it won't fall back to computing from geometry origin.
    this.geometry.boundingSphere = new Sphere(new Vector3(), 0);
  }

  addBlock(locString: string, block: Block) {
    if (!block) throw new Error(`Given block is ${block}`);
    if (this.locStringToInstance.get(locString) !== undefined) {
      this.removeBlock(locString);
    }
    const coords = locString.split(",");
    const x = Number(coords[0]), y = Number(coords[1]), z = Number(coords[2]);
    const mat = new Matrix4().setPosition(x, y, z);
    this.setMatrixAt(this.count, mat);
    this.instanceMatrix.needsUpdate = true;
    this.locStringToInstance.add(locString, this.count);
    this.count++;
    this._expandAndUpdate(x, y, z);
  }

  removeBlock(locString: string) {
    const remIdx = this.locStringToInstance.get(locString);
    if (remIdx === undefined) return;

    const mat = new Matrix4();
    this.getMatrixAt(this.count - 1, mat);
    this.setMatrixAt(remIdx, mat);
    this.instanceMatrix.needsUpdate = true;

    this.locStringToInstance.remove(locString);
    const movedLocString = this.locStringToInstance.getByValue(this.count - 1);
    this.locStringToInstance.remove(movedLocString);
    this.locStringToInstance.add(movedLocString, remIdx);
    this.count--;

    if (this.count === 0) this._resetBounds();
    // Intentionally not shrinking the sphere on remove — see class comment.
  }

  clearAll() {
    this.locStringToInstance = new BidirectionalMap({});
    this.count = 0;
    this.instanceMatrix.needsUpdate = true;
    this._resetBounds();
  }

  setFromDynamicInstancedMesh(dynInstMesh: DynamicInstancedMesh) {
    this.locStringToInstance = dynInstMesh.locStringToInstance;
    const mat = new Matrix4();
    for (let i = 0; i < dynInstMesh.count; i++) {
      dynInstMesh.getMatrixAt(i, mat);
      this.setMatrixAt(i, mat);
      this.instanceMatrix.needsUpdate = true;
      this.count++;
    }
    // Copy bounding box from source so we don't recompute from scratch.
    this._bmin.copy(dynInstMesh._bmin);
    this._bmax.copy(dynInstMesh._bmax);
    this._updateSphere();
  }

  // Expand the bounding box to include (x, y, z) and refresh the sphere.
  private _expandAndUpdate(x: number, y: number, z: number) {
    let changed = false;
    if (x < this._bmin.x) { this._bmin.x = x; changed = true; }
    if (y < this._bmin.y) { this._bmin.y = y; changed = true; }
    if (z < this._bmin.z) { this._bmin.z = z; changed = true; }
    if (x > this._bmax.x) { this._bmax.x = x; changed = true; }
    if (y > this._bmax.y) { this._bmax.y = y; changed = true; }
    if (z > this._bmax.z) { this._bmax.z = z; changed = true; }
    if (changed) this._updateSphere();
  }

  // Recompute the bounding sphere from the current bounding box.
  // Centre is the box midpoint; radius covers the half-diagonal of the box
  // plus √3/2 ≈ 0.87 so the full unit-cube extent of each block is enclosed.
  private _updateSphere() {
    const cx = (this._bmin.x + this._bmax.x) * 0.5;
    const cy = (this._bmin.y + this._bmax.y) * 0.5;
    const cz = (this._bmin.z + this._bmax.z) * 0.5;
    const dx = (this._bmax.x - this._bmin.x) * 0.5 + 0.87;
    const dy = (this._bmax.y - this._bmin.y) * 0.5 + 0.87;
    const dz = (this._bmax.z - this._bmin.z) * 0.5 + 0.87;
    this.geometry.boundingSphere!.center.set(cx, cy, cz);
    this.geometry.boundingSphere!.radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private _resetBounds() {
    this._bmin.set(Infinity, Infinity, Infinity);
    this._bmax.set(-Infinity, -Infinity, -Infinity);
    this.geometry.boundingSphere!.center.set(0, 0, 0);
    this.geometry.boundingSphere!.radius = 0;
  }
}

class BidirectionalMap {
  fwdMap = {} as { [locString: string]: number };
  revMap = {} as { [index: number]: string };

  constructor(map: { [key: string]: number }) {
    this.fwdMap = { ...map };
    this.revMap = Object.keys(map).reduce(
      (acc, cur) => ({
        ...acc,
        [map[cur]]: cur,
      }),
      {}
    )
  }

  get(key: string): number | undefined {
    return this.fwdMap[key];
  }

  getByValue(value: number) {
    return this.revMap[value];
  }

  add(locString: string, index: number) {
    this.fwdMap[locString] = index;
    this.revMap[index] = locString;
  }

  remove(locString: string) {
    const index = this.fwdMap[locString];
    if (index === undefined) return;
    delete this.fwdMap[locString];
    delete this.revMap[index];
  }

  removeByValue(index: number) {
    const locstring = this.revMap[index];
    if (index === undefined) return;
    delete this.revMap[index];
    delete this.fwdMap[locstring];
  }
}

export default DynamicInstancedMesh;
