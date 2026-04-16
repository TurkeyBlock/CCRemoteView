<template>
  <div class="scene"></div>
</template>

<script lang="ts">
import { defineComponent, ref, toRaw } from "vue";
import { useWorldStore } from "../store/useWorld";
import { useWorldViewStore } from "../store/useWorldView";
import * as THREE from "three";
import CameraControls from "camera-controls";
import { PerspectiveCamera, Scene } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Block } from "../types/types";
import { ChunkManager } from "../utils/ChunkManager";
import DynamicInstancedMesh from "../utils/DynamicInstancedMesh";

CameraControls.install({ THREE: THREE });

var scene: Scene,
  camera: PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  cameraControls: CameraControls,
  blocks: THREE.Group,
  entities: THREE.Group,
  inventoryIndicators: THREE.Group,
  inventorySprites = new Map<string, THREE.Sprite>(),
  exclamationMaterial: THREE.SpriteMaterial,
  raycaster: THREE.Raycaster,
  clock: THREE.Clock,
  mouse = { x: 0, y: 0 },
  turtleModel: THREE.Object3D,
  chunkManager: ChunkManager,
  animatedTextures = [] as TextureAnimator[],
  entityGeometry: THREE.OctahedronGeometry,
  entityMaterials: { [name: string]: THREE.MeshPhongMaterial } = {},
  entityFallbackMaterial: THREE.MeshPhongMaterial,
  // Raw (non-reactive) store references for the animate() hot path.
  // toRaw() strips Vue's Proxy wrapper so repeated per-frame reads don't
  // pay the Reflect.get / reactive-tracking overhead on every access.
  rawWorld: ReturnType<typeof useWorldStore>,
  rawWorldView: ReturnType<typeof useWorldViewStore>;

class TextureAnimator {
  texture: THREE.Texture;
  tileDurationMillis: number;
  tilesHorizontal: number;
  tilesVertical: number;
  numberOfTiles: number;
  currentDisplayMillis: number;
  currentTile: number;
  forward: boolean;

  constructor(texture: THREE.Texture, tileDurationMillis: number) {
    this.texture = texture;
    this.tileDurationMillis = tileDurationMillis;
    this.tilesHorizontal = 1;
    this.tilesVertical = texture.image.height / texture.image.width;
    this.numberOfTiles = this.tilesHorizontal * this.tilesVertical;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1 / this.tilesHorizontal, 1 / this.tilesVertical);
    this.currentDisplayMillis = 0;
    this.currentTile = 0;
    this.forward = true;
  }

  update(milliSec: number) {
    this.currentDisplayMillis += milliSec;
    while (this.currentDisplayMillis > this.tileDurationMillis) {
      this.currentDisplayMillis -= this.tileDurationMillis;
      this.currentTile += this.forward ? 1 : -1;
      if (this.currentTile == this.numberOfTiles - 1 || this.currentTile == 0)
        this.forward = !this.forward;
      const currentColumn = this.currentTile % this.tilesHorizontal;
      const currentRow = Math.floor(this.currentTile / this.tilesHorizontal);
      this.texture.offset.x = currentColumn / this.tilesHorizontal;
      this.texture.offset.y = currentRow / this.tilesVertical;
    }
  }
}

export default defineComponent({
  setup() {
    const world = useWorldStore();
    const worldView = useWorldViewStore();
    const geometry = new THREE.BoxGeometry();

    rawWorld = toRaw(world);
    rawWorldView = toRaw(worldView);

    return { world, worldView, geometry };
  },
  methods: {
    onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();

      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.render(scene, camera);
    },
    initScene() {
      const loader = new GLTFLoader();

      loader.load(
        "textures/turtle/CCTurtle_happy.glb",
        (gltf) => (turtleModel = gltf.scene),
        undefined,
        (error) => console.error(error)
      );
      renderer = new THREE.WebGLRenderer();
      renderer.setSize(window.innerWidth, window.innerHeight);

      raycaster = new THREE.Raycaster();
      renderer.domElement.addEventListener(
        "dblclick",
        (e) => {
          this.raycast(e);
          if (
            isNaN(this.worldView.selectedComputerId) ||
            this.worldView.selectedComputerId == -1 ||
            this.worldView.gotoBlockPos == null
          )
            return;
          const hLoc = this.worldView.gotoBlockPos;
          this.world.sendCommand(
            this.worldView.selectedComputerId,
            "tapi.goTo(" + hLoc.x + "," + hLoc.y + "," + hLoc.z + ")"
          );
        },
        false
      );

      renderer.domElement.addEventListener(
        "click",
        (e) => {
          this.raycast(e);
          if (this.worldView.hoveredEntity) {
            // entity click — inventory display not applicable
            this.worldView.selectedInventory = null;
            this.worldView.selectedInventorySize = 0;
          } else if (
            this.worldView.hoveredBlock &&
            this.worldView.hoveredBlock.inventory
          ) {
            this.worldView.selectedInventory =
              this.worldView.hoveredBlock.inventory;
            this.worldView.selectedInventorySize = this.worldView.hoveredBlock
              .inventorySize as number;
          } else {
            this.worldView.selectedInventory = null;
            this.worldView.selectedInventorySize = 0;
          }
        },
        false
      );

      // renderer.domElement.addEventListener("mousemove", this.raycast, false);

      window.addEventListener("resize", this.onWindowResize, false);

      document.body.appendChild(renderer.domElement);

      clock = new THREE.Clock();

      camera = new THREE.PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        1,
        10000
      );
      camera.position.set(-4, 5, -10);
      camera.lookAt(0, 0, 0);

      scene = new THREE.Scene();
      blocks = new THREE.Group();
      scene.add(blocks);
      entities = new THREE.Group();
      scene.add(entities);

      const exclCanvas = document.createElement('canvas');
      exclCanvas.width = 64;
      exclCanvas.height = 64;
      const exclCtx = exclCanvas.getContext('2d')!;
      exclCtx.fillStyle = 'rgba(0,0,0,0.55)';
      exclCtx.beginPath();
      exclCtx.arc(32, 32, 28, 0, Math.PI * 2);
      exclCtx.fill();
      exclCtx.fillStyle = '#ffffff';
      exclCtx.font = 'bold 52px sans-serif';
      exclCtx.textAlign = 'center';
      exclCtx.textBaseline = 'middle';
      exclCtx.fillText('!', 32, 34);
      exclamationMaterial = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(exclCanvas), depthTest: false });
      inventoryIndicators = new THREE.Group();
      scene.add(inventoryIndicators);

      entityGeometry = new THREE.OctahedronGeometry(0.35);
      entityFallbackMaterial = new THREE.MeshPhongMaterial({ color: 0xff8800 });

      cameraControls = new CameraControls(camera, renderer.domElement);

      // Re-evaluate chunk visibility whenever the camera moves or rotates.
      cameraControls.addEventListener('update', () => this.updateChunkVisibility());

      renderer.render(scene, camera);
    },
    getGotoBlockPosFromIntersect(intersection: THREE.Intersection) {
      let transform = new THREE.Matrix4();
      let instMesh = <DynamicInstancedMesh>intersection.object;
      instMesh.getMatrixAt(<number>intersection.instanceId, transform);
      let instPos = new THREE.Vector3().setFromMatrixPosition(transform);
      let offset = intersection.point.clone().sub(instPos);
      let vabs = new THREE.Vector3(
        Math.abs(offset.x),
        Math.abs(offset.y),
        Math.abs(offset.z)
      ).toArray();
      let idx = vabs.indexOf(Math.max(...vabs));
      let discreteOffset = new THREE.Vector3(0, 0, 0);
      for (let i = 0; i < 3; i++) {
        if (i == idx)
          discreteOffset.setComponent(i, offset.getComponent(i) > 0 ? 1 : -1);
      }
      return instPos.clone().add(discreteOffset);
    },
    animate() {
      const delta = clock.getDelta();

      // Check if followed turtle moved. Use raw (non-reactive) store refs so
      // these per-frame reads don't pay Vue Proxy / Reflect.get overhead.
      const computerId = rawWorldView.followedComputer.computerId;
      if (computerId != -1) {
        const currPos = rawWorld.computers[computerId]?.loc;
        const lastPos = rawWorldView.followedComputer.lastPos;
        if (
          currPos && lastPos &&
          (currPos.x !== lastPos.x ||
          currPos.y !== lastPos.y ||
          currPos.z !== lastPos.z)
        ) {
          rawWorldView.setCameraFocus(
            new THREE.Vector3(currPos.x, currPos.y, currPos.z)
          );
          // Write directly to raw object — lastPos is only read here, so no
          // reactive notification is needed and this avoids Proxy setter cost.
          rawWorldView.followedComputer.lastPos = currPos;
        }
      }

      cameraControls.update(delta);
      for (const el of animatedTextures) {
        el.update(delta * 1000);
      }
      requestAnimationFrame(this.animate);
      this.render();
    },
    raycast(e: any) {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Check entities first — they're smaller and would lose to blocks otherwise
      const entityHits = raycaster.intersectObjects(entities.children, false);
      if (entityHits.length > 0) {
        const mesh = entityHits[0].object as THREE.Mesh;
        this.worldView.hoveredEntity = (mesh as any).userData.entity;
        this.worldView.hoveredBlock = null;
        this.worldView.hoveredBlockPos = null;
        this.worldView.gotoBlockPos = null;
        return;
      }
      this.worldView.hoveredEntity = null;

      const intersects = raycaster.intersectObjects(blocks.children);
      for (let i = 0; i < intersects.length; i++) {
        let instMesh = <DynamicInstancedMesh>intersects[i].object;
        let transform = new THREE.Matrix4();
        instMesh.getMatrixAt(<number>intersects[i].instanceId, transform);
        let instPos = new THREE.Vector3().setFromMatrixPosition(transform);
        this.worldView.hoveredBlock = this.world.getBlockByObjPosition(instPos);
        this.worldView.hoveredBlockPos = instPos;
        this.worldView.gotoBlockPos = this.getGotoBlockPosFromIntersect(
          intersects[i]
        );
        return;
      }
      this.worldView.hoveredBlock = null;
      this.worldView.hoveredBlockPos = null;
      this.worldView.gotoBlockPos = null;
    },
    async regenerateSceneFromBlocks() {
      const world = useWorldStore();

      // delete objects
      scene.remove.apply(scene, scene.children);
      blocks.remove.apply(blocks, blocks.children);
      entities.remove.apply(entities, entities.children);
      inventoryIndicators.remove.apply(inventoryIndicators, inventoryIndicators.children);
      inventorySprites.clear();
      this.worldView.entityMeshes = {};
      this.worldView.computerModels = {};

      // add lighting
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(1, 2, 3);
      scene.add(directionalLight);
      const directionalLight2 = new THREE.DirectionalLight(0x777777, 1);
      directionalLight2.position.set(-1, -2, -3);
      scene.add(directionalLight2);
      const ambientLight = new THREE.AmbientLight(0x404040); // soft white light
      scene.add(ambientLight);

      if (chunkManager) chunkManager.dispose();
      chunkManager = new ChunkManager(blocks);

      // Add groups to scene first so blocks appear progressively during async load.
      scene.add(blocks);
      scene.add(entities);
      scene.add(inventoryIndicators);

      // Position the camera before blocks start loading so the first rendered
      // chunks appear around a known location rather than the origin.
      if (this.worldView.selectedComputerId !== -1) {
        this.focusOnComputer(this.worldView.selectedComputerId);
      }

      // Bulk-load: partition all blocks into chunks, kick off async builds.
      await chunkManager.bulkLoad(
        world.blocks,
        (loc) => this.worldView.isBlockVisible(loc),
      );

      // Initial visibility pass with current camera state.
      this.updateChunkVisibility();

      // Inventory indicators are cheap — add them after the bulk load.
      for (const locString in world.blocks) {
        if (world.blocks[locString].inventory) {
          this.addInventoryIndicator(locString);
        }
      }

      this.addComputers();
    },
    addInventoryIndicator(locString: string) {
      if (inventorySprites.has(locString)) return;
      const [x, y, z] = locString.split(',').map(Number);
      const sprite = new THREE.Sprite(exclamationMaterial);
      sprite.position.set(x, y + 0.9, z);
      sprite.scale.set(0.5, 0.5, 0.5);
      inventoryIndicators.add(sprite);
      inventorySprites.set(locString, sprite);
    },
    removeInventoryIndicator(locString: string) {
      const sprite = inventorySprites.get(locString);
      if (sprite) {
        inventoryIndicators.remove(sprite);
        inventorySprites.delete(locString);
      }
    },
    addBlock(locString: string, block: Block) {
      if (!this.worldView.isBlockVisible(locString)) return;
      chunkManager.addBlock(locString, block);
      if (block.inventory) {
        this.addInventoryIndicator(locString);
      } else {
        this.removeInventoryIndicator(locString);
      }
    },
    removeBlock(locString: string) {
      chunkManager.removeBlock(locString);
      this.removeInventoryIndicator(locString);
    },
    clearAllBlocks() {
      chunkManager.clearAll();
    },
    updateChunkVisibility() {
      if (!chunkManager || !camera || !cameraControls) return;
      const target = new THREE.Vector3();
      cameraControls.getTarget(target);
      chunkManager.updateVisibility(camera, target, rawWorldView.renderDistance);
    },
    addComputers() {
      for (const computerId in this.world.computers) {
        this.addComputer(computerId);
        this.updateEntities(computerId);
      }
    },
    addComputer(computerId: string) {
      const computerData = this.world.computers[computerId];
      if (!computerData?.loc) return;
      const model = turtleModel.clone();
      scene.add(model);
      this.worldView.computerModels[computerId] = model;
      model.position.set(computerData.loc.x, computerData.loc.y, computerData.loc.z);
      if (computerData.type === 'minecart') {
        model.rotation.set(0, 0, 0);
        const locString = `${computerData.loc.x},${computerData.loc.y},${computerData.loc.z}`;
        chunkManager.removeBlock(locString);
      } else {
        model.rotation.set(Math.PI / 2, 0, ((computerData.rot + 1) * Math.PI) / 2);
      }
    },
    updateComputer(computerId: string) {
      let model = this.worldView.computerModels[computerId];
      if (!model) {
        this.addComputer(computerId);
        return;
      }
      const computerData = this.world.computers[computerId];
      if (!computerData?.loc) return;
      if (computerData.type === 'minecart') {
        const oldX = Math.round(model.position.x);
        const oldY = Math.round(model.position.y);
        const oldZ = Math.round(model.position.z);
        const newX = computerData.loc.x;
        const newY = computerData.loc.y;
        const newZ = computerData.loc.z;
        if (oldX !== newX || oldY !== newY || oldZ !== newZ) {
          const oldLocString = `${oldX},${oldY},${oldZ}`;
          const oldBlock = this.world.blocks[oldLocString];
          if (oldBlock && this.worldView.isBlockVisible(oldLocString)) {
            chunkManager.addBlock(oldLocString, oldBlock);
          }
          chunkManager.removeBlock(`${newX},${newY},${newZ}`);
        }
        model.rotation.set(0, 0, 0);
      } else {
        model.rotation.set(Math.PI / 2, 0, ((computerData.rot + 1) * Math.PI) / 2);
      }
      model.position.set(computerData.loc.x, computerData.loc.y, computerData.loc.z);
      model.updateMatrix();
    },
    getEntityMaterial(name: string): THREE.MeshPhongMaterial {
      if (!entityMaterials[name]) {
        const mat = new THREE.MeshPhongMaterial({ color: 0xff8800 });
        entityMaterials[name] = mat;
        const loader = new THREE.TextureLoader();
        const world = useWorldStore();
        loader.load(
          world.textureURL + `entities/${name.replace(':', '/')}.png`,
          (texture) => {
            texture.minFilter = THREE.NearestFilter;
            texture.magFilter = THREE.NearestFilter;
            mat.map = texture;
            mat.color.setHex(0xffffff);
            mat.needsUpdate = true;
          },
          undefined,
          () => { /* no texture found — keep fallback orange */ }
        );
      }
      return entityMaterials[name];
    },
    updateEntities(computerId: string) {
      const computer = this.world.computers[computerId];
      const prefix = `${computerId}:`;

      // Remove old meshes for this computer before adding new ones
      const oldKeys = Object.keys(this.worldView.entityMeshes).filter(key => key.startsWith(prefix));
      for (const key of oldKeys) {
        const mesh = this.worldView.entityMeshes[key];
        if (mesh && mesh.parent === entities) {
          entities.remove(mesh);
        }
        delete this.worldView.entityMeshes[key];
      }

      if (!computer?.entities || !computer.loc) return;
      const origin = computer.loc;

      for (const entity of computer.entities) {
        const mat = this.getEntityMaterial(entity.name);
        const mesh = new THREE.Mesh(entityGeometry, mat);
        const wx = origin.x + entity.x;
        const wy = origin.y + entity.y;
        const wz = origin.z + entity.z;
        mesh.position.set(wx, wy, wz);
        (mesh as any).userData.entity = {
          ...entity,
          worldPos: new THREE.Vector3(wx, wy, wz),
        };
        entities.add(mesh);
        this.worldView.entityMeshes[`${prefix}${entity.id}`] = mesh;
      }
    },
    removeComputerModel(computerId: string) {
      const model = this.worldView.computerModels[computerId];
      if (model) {
        scene.remove(model);
        delete this.worldView.computerModels[computerId];
      }
    },
    setCameraFocus(target: THREE.Vector3) {
      cameraControls.moveTo(target.x, target.y, target.z, true);
    },
    focusOnComputer(computerId: number) {
      const world = useWorldStore();
      const computer = world.computers[computerId];
      if (!computer?.loc) return;
      this.setCameraFocus(
        new THREE.Vector3(computer.loc.x, computer.loc.y, computer.loc.z)
      );
    },
    addAnimatedTexture(texture: THREE.Texture) {
      animatedTextures.push(new TextureAnimator(texture, 1000 / 8));
    },
    render() {
      renderer.render(scene, camera);
    },
  },
  mounted() {
    this.initScene();
    this.animate();
    const worldView = useWorldViewStore();
    worldView.regenerateSceneFromBlocks = this.regenerateSceneFromBlocks;
    worldView.render = this.render;
    worldView.setCameraFocus = this.setCameraFocus;
    worldView.focusOnComputer = this.focusOnComputer;
    worldView.addBlock = this.addBlock;
    worldView.removeBlock = this.removeBlock;
    worldView.clearAllBlocks = this.clearAllBlocks;
    worldView.updateComputer = this.updateComputer;
    worldView.updateEntities = this.updateEntities;
    worldView.removeComputerModel = this.removeComputerModel;
    worldView.addAnimatedTexture = this.addAnimatedTexture;
    worldView.updateChunkVisibility = this.updateChunkVisibility;
  },
});
</script>
