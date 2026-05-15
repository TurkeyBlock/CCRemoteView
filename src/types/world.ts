interface ComputerState {
    id: number,
    label: "",
    type?: 'turtle' | 'minecart' | 'player' | 'stationary',
    loc: Vec,
    rot: number,
    inv: ItemStack[],
    selectedSlot: number,
    view?: {
        front?: Block | null,
        top?: Block | null,
        bottom?: Block | null,
    },
    adjacentInventory?: Record<string, { inventory: Inventory, inventorySize: number }>,
    fuelLevel: number,
    fuelLimit: number,
    ws_connected?: boolean,
    ws_request_at?: number | null,
    modified?: number,
    lastPoll?: number,
    entities?: EntitySighting[],
    peripherals?: string[],
    actionSeq?: number,
    // Player (neural interface) — populated by papi live coroutines / introspection commands
    playerName?: string,
    inventory?: Record<string, ItemStack>,
    equipment?: Record<string, ItemStack>,
    enderChest?: Record<string, ItemStack>,
    metaOwner?: unknown,
    // Glasses canvas — scene persisted by setGlassesScene WS op, synced to all browsers
    glassesScene?: import('./glasses').GlassesObject[],
}

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

export type { ComputerState, SimState, Block, ItemStack, Item, Vec, Inventory, EntitySighting, ChatMessage };