interface ComputerState {
    id: number,
    label: "",
    type?: 'turtle' | 'minecart' | 'modem' | 'player' | 'stationary',
    loc: Vec,
    rot: number,
    inv: ItemStack[],
    selectedSlot: number,
    view: {
        front: 0,
        top: 0,
        bottom: 0
    },
    fuelLevel: number,
    fuelLimit: number,
    ws_connected?: boolean,
    modified?: number,
    lastSeen?: number,
    via_modem?: boolean,
    has_modem_peripheral?: boolean,
    poll_interval?: number,
    entities?: EntitySighting[],
    chatLog?: ChatMessage[],
    peripherals?: string[],
    actionSeq?: number,
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
}

interface SimState {
    computers: { [id: string]: ComputerState },
    world: { [locString: string]: Block },
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