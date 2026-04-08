import { defineStore } from 'pinia'
import { TurtleState, Block } from '../types/types';
import { useWorldViewStore } from './useWorldView';

// you have to set this to "http://localhost/" or "http://<your public ip>/" 
// (if you use public ip you also have to forward port 3000) if you want to develop using rpm run dev
// after developing you can reset it to an empty string or this might cause you a headache if you switch from localhost to public ip hosting
const url = ""

export const useWorldStore = defineStore('world', {
  state: () => ({
    computers: {} as { [id: string]: TurtleState; },
    blocks: {} as { [locString: string]: Block; },
    commandResult: {} as { [id: string]: string; },
    URL: `${url}`,
    apiURL: `${url}api/`,
    textureURL: `${url}textures/`,
    lastTransactionId: -1,
    isLoading: true,
    isUnauthorized: false,
  }),
  getters: {
    getComputerIds(): number[] {
      return Object.keys(this.computers).map(key => Number(key));
    },
  },
  actions: {
    setComputerStatus(remoteTurtleState: any) {

      for (let id in remoteTurtleState) {
        let turtleState = remoteTurtleState[id];
        if (!this.computers[id]) {
          const worldView = useWorldViewStore();
          worldView.selectedComputerId = parseInt(id);
        }
        this.computers[id] = { ...turtleState, entities: turtleState.entities ? [...turtleState.entities] : undefined };
        this.computers[id].modified = Date.now();

        // replace 0s in inv with null (computers only)
        if (turtleState.inv) {
          for (let i = 0; i < turtleState.inv.length; i++)
            if (turtleState.inv[i] === 0) turtleState.inv[i] = undefined;
        }
      }
    },
    transactionRemoveBlock(locString: string) {
      const worldView = useWorldViewStore();
      worldView.removeBlock(locString);
      delete this.blocks[locString];
    },
    transactionAddBlock(locString: string, block: Block) {
      const worldView = useWorldViewStore();
      worldView.removeBlock(locString);
      this.blocks[locString] = block;
      worldView.addBlock(locString, block);
    },
    transactionSetComputerState(computerState: any) {
      this.setComputerStatus(computerState);
      const worldView = useWorldViewStore();
      for (const id of Object.keys(computerState)) {
        worldView.updateComputer(id);
        if (computerState[id].entities !== undefined) {
          worldView.updateEntities(id);
        }
      }
    },
    applyTransactions(transactions: any) {
      let currTransactionId = this.lastTransactionId;
      const len = Object.keys(transactions).length
      for (let i = 0; i < len; i++) {
        currTransactionId++;
        const t = transactions[currTransactionId];
        for (const [locString, block] of Object.entries(t.blocks)) {
          if (block) {
            this.transactionAddBlock(locString, block as Block);
          }
          else this.transactionRemoveBlock(locString);
        }
        this.transactionSetComputerState(t.computers);
        this.lastTransactionId = currTransactionId;
      }
    },
    sendCommand(computerId: number, cmd: string) {
      fetch(this.apiURL + "setCommand", {
        method: 'POST',
        mode: "cors",
        headers: {
          "Access-Control-Allow-Origin": "*",
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: computerId, cmd: cmd }),
      })
        .then((res) => res.json())
        .then((data) => {
          console.log(data);
        });
    },
    sendStopSignal(computerId: number) {
      fetch(this.apiURL + "setStopSignal", {
        method: 'POST',
        mode: "cors",
        headers: {
          "Access-Control-Allow-Origin": "*",
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: computerId }),
      })
        .then((res) => res.json())
        .then((data) => {
          console.log(data);
        });
    },
    clearCommandQueue(computerId: number) {
      fetch(this.apiURL + "clearCommandQueue", {
        method: 'POST',
        mode: "cors",
        headers: {
          "Access-Control-Allow-Origin": "*",
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: computerId }),
      })
        .then((res) => res.json())
        .then((data) => {
          console.log(data);
        });
    },
    removeComputer(id: string | number) {
      const worldView = useWorldViewStore();
      const sid = String(id);
      delete this.computers[sid];
      if (worldView.selectedComputerId === Number(id)) {
        worldView.selectedComputerId = -1;
      }
      worldView.updateEntities(sid);      // wipes entity meshes from scene
      worldView.removeComputerModel(sid); // removes 3D model from scene
    },
    clearBlocks() {
      const worldView = useWorldViewStore();
      worldView.clearAllBlocks();
      this.blocks = {};
    },
    getBlockByObjPosition(pos: THREE.Vector3) {
      return this.blocks[pos.x + "," + pos.y + "," + pos.z];
    },
  },
})