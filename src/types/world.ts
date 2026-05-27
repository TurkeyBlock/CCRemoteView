interface ComputerBase {
    id: number,
    label: string,
    loc: Vec,
    rot: number,
    wsConnected?: boolean,
    wsRequestAt?: number | null,
    modified?: number,
    lastPoll?: number,
    entities?: EntitySighting[],
    peripherals?: string[],
    actionSeq?: number,
    metaOwner?: unknown,
    // Transport marker — present only on delta transactions sent by transactComputerDelta.
    // Tells the browser to merge rather than replace. Never persisted in Zustand.
    _delta?: true,
}

interface TurtleState extends ComputerBase {
    type: 'turtle',
    inv?: ItemStack[],
    selectedSlot?: number,
    view?: {
        front?: Block | null,
        top?: Block | null,
        bottom?: Block | null,
    },
    adjacentInventory?: Record<string, { inventory: Inventory, inventorySize: number }>,
    fuelLevel?: number,
    fuelLimit?: number,
}

interface PlayerState extends ComputerBase {
    type: 'player',
    playerName?: string,
    inventory?: Record<string, ItemStack>,
    equipment?: Record<string, ItemStack>,
    enderChest?: Record<string, ItemStack>,
    yaw?: number,
    pitch?: number,
    health?: number,
    maxHealth?: number,
    foodLevel?: number,
    glassesScene?: import('./glasses').GlassesObject[],
}

interface MinecartState extends ComputerBase {
    type: 'minecart',
}

interface StationaryState extends ComputerBase {
    type: 'stationary',
}

// Computers whose type hasn't been reported yet
interface UnknownComputerState extends ComputerBase {
    type?: undefined,
}

type ComputerState = TurtleState | PlayerState | MinecartState | StationaryState | UnknownComputerState

function isTurtle(c: ComputerState): c is TurtleState { return c.type === 'turtle' }
function isPlayer(c: ComputerState): c is PlayerState { return c.type === 'player' }
function isMinecart(c: ComputerState): c is MinecartState { return c.type === 'minecart' }
function isStationary(c: ComputerState): c is StationaryState { return c.type === 'stationary' }

interface EntitySighting {
    id: string,
    name: string,
    x: number,
    y: number,
    z: number,
}

interface ChatMessage {
    player: string,
    message: string,
    uuid: string,
    timestamp: number,
    computerId?: number,
}

interface SimState {
    computers: { [id: string]: ComputerState },
    world: { [locString: string]: Block },
    chatLog: ChatMessage[],
}

interface Block {
    name: string,
    metadata: number,
    state?: Object,
    tags?: Object,
    inventory?: Inventory,
    inventorySize?: number,
}

interface ItemStack {
    count: number,
    name: string,
    damage?: number,
}

interface Item {
    name: string,
    damage: number,
}

type Vec = {
    x: number,
    y: number,
    z: number,
}

type Inventory = [{ name: string, count: number }]

export type { ComputerState, TurtleState, PlayerState, MinecartState, StationaryState, SimState, Block, ItemStack, Item, Vec, Inventory, EntitySighting, ChatMessage };
export { isTurtle, isPlayer, isMinecart, isStationary };