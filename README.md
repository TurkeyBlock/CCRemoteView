# ComputerCraft Browser Interface

A browser-based remote control and live world map for ComputerCraft computers running on **Minecraft 1.12 (Tekkit2)**. View a real-time 3D render of the area around your computers and control turtles, minecarts, stationary computers, and player neural interfaces from a single browser interface.

![til](https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/FullPage.png)

<a href="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/TurtleControl.gif"><img src="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/TurtleControl.gif" width="49%"></a>
<a href="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/InventoryGUI.gif"><img src="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/InventoryGUI.gif" width="49%"></a>

---

## Features

**Visualization**
- **Live 3D world map** — scanned blocks rendered in real time as instanced geometry, with extracted Minecraft textures and biome tinting
- **Entity detection** — scan nearby mobs and players (requires Plethora)

**Control**
- **Multi-computer interface** — turtles, minecarts, stationary computers, and player neural interfaces managed from a single drag-and-drop panel UI
- **Command queue** — all commands are queued and executed in order; spamming a key queues every press rather than dropping inputs
- **Lua terminal** — send arbitrary Lua directly to any connected computer (admin only)

**Inventory**
- **Inventory management** — drag-and-drop turtle inventory slots, Ctrl+click to move whole stacks, fuel gauge, active slot display
- **Adjacent chest interaction** — clicking a chest next to a turtle in the 3D view opens its inventory as a GUI overlay; items can be dragged between the chest and the turtle's own inventory without any in-game input

**Player HUD**
- **Ride-along** — locks the 3D camera to follow a player computer's position through the pre-scanned world map, letting you see the environment from the player's perspective in real time
- **Glasses HUD editor** — co-op browser canvas editor for `plethora:glasses`; draw rects, polygons, text, lines, item icons and groups on a 512×288 canvas with pixel-accurate Minecraft font preview; Live tab streams every edit directly to the player's HUD in real time; Draft tab supports undo/redo before publishing

**System**
- **User roles** — admin, operator, and guest tiers with IP-based computer approval
- **Persistent world state** — block and computer state saved to disk and restored on restart

---

## How It Works

Three layers communicate in real time:

1. **ComputerCraft (Lua)** — scripts on each in-game computer POST their state (blocks, inventory, fuel, position) to the server and receive queued commands back over WebSocket.
2. **Node.js server** — relays commands, merges incoming state, persists world data to disk, and serves the browser interface.
3. **Browser** — renders the 3D world map using Three.js, and lets operators queue commands, manage inventory, and edit the glasses HUD.

Block data accumulates across sessions — each area scan adds to the persistent world map rather than replacing it.

---

## Requirements

- **Node.js 20+**
- **Minecraft 1.12** with [CC:Tweaked](https://tweaked.cc/) (or a compatible ComputerCraft fork)
- **[Plethora Peripherals](https://plethora.madefor.cc/)** — required for block scanning, entity scanning, minecart computers, and player neural interfaces; basic turtle movement and inventory work without it
- HTTP access from ComputerCraft to the host machine (see [Minecraft Setup](#minecraft-setup))

> **Minecraft version note:** This project targets 1.12 block data structures. Later versions change how block state and metadata are stored; the underlying mechanics are stable but texture and block mapping are not going to work as expected for 1.13+.

---

## Setup

### Development

```bash
npm install
npm run dev
```

The interface is available at `http://localhost:8081`. Dev mode binds to `127.0.0.1` only and disables authentication — the server is unreachable from the network with no configuration required.

Optionally extract block textures for the 3D view (blocks render as solid colours without them):

```bash
npm run build-textures "<path/to/minecraft.jar>" "<optional: path/to/mods/>"
```

See [docs/textures.md](docs/textures.md) for platform-specific paths and troubleshooting.

### Production

Create `.env.local` from the example file, set `APP_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`, then:

```bash
npm run build
npm run start
```

For packaged standalone distribution (bundled Node.js binary, no separate install required), and for full authentication configuration, see [docs/deployment.md](docs/deployment.md).

---

## Minecraft Setup

ComputerCraft blocks HTTP to unlisted hosts by default. Add your host machine's IP to the HTTP whitelist — in 1.12 this is `config/computercraft.cfg`; in newer CC:Tweaked versions it's `<world>/serverconfig/computercraft-server.toml`.

Once the server is running, approve computer IPs through the **Admin** tab in the browser interface.

### Adding Computers

Run the following in the in-game terminal, replacing `<APP_URL>` with your server address or `localhost` as applicable:

| Computer type | Startup command |
|--------------|-----------------|
| Turtle | `wget run http://<APP_URL>/lua/turtle/startup` |
| Minecart | `wget run http://<APP_URL>/lua/minecart/startup` |
| Stationary | `wget run http://<APP_URL>/lua/stationary/startup` |
| Player (neural interface) | `wget run http://<APP_URL>/lua/player/startup` |

The startup script downloads the required files, registers with the server, and waits for admin approval. Once approved, the computer appears in the UI.

**Location:** On first boot a turtle attempts a GPS fix. If GPS is unavailable it falls back to a saved position, or prompts for manual entry in the format `x y z facing` (e.g. `-263 68 79 south`).

### Block Scanning & World Map

The 3D world map is built from block data sent by in-game computers. There are two tiers:

- **Adjacent blocks only** — the three blocks immediately in front of, above, and below the turtle, reported automatically after every movement or dig. No peripherals required.
- **Area scan** — a 9×9×9 cube centred on the computer. Requires a **`plethora:scanner`** module equipped on the computer. The `Scan` button in the UI triggers this; from the Lua terminal it's `tapi.scan()` for turtles, `mapi.scan()` for minecarts, `sapi.scan()` for stationary computers, and `papi.scan()` for player neural interfaces. Without the scanner module the command returns an error.

### Peripheral Requirements

Plethora Peripherals enables all scanning, entity detection, and HUD features. Movement, digging, and inventory management are built into ComputerCraft and require no peripherals.

| Peripheral | Enables | Notes |
|---|---|---|
| `plethora:scanner` | `scan()` — 9×9×9 area block scan | All computer types. Turtle: equip in the **left slot** or leave in turtle's inventory. Player: attach as a neural interface module. |
| `plethora:sensor` | `sense()` — detect nearby mobs and players | All computer types. Turtle: equip in the **left slot** or leave in turtle's inventory. Player: attach as a neural interface module. |
| `plethora:chat` | `say()` — listen to in-game chat messages. Sending chats may be done via neural interface or with player-bound chat peripherals. | All computer types.
| Advanced wireless modem | GPS location fix - turtles can (following initial setup) derrive location without this, but other computers can not. | Turtle startup auto-equips one from inventory into the **right slot**. A GPS satellite network must be set up in-world. |
| `plethora:glasses` module | Glasses HUD canvas editor; all `glasses*` commands | Player (neural interface) only. |

On turtles the **right slot** is reserved for the wireless modem and the **left slot** is hot-swappable — you can swap between scanner, sensor, and chat peripherals at runtime without rebooting. Only one Plethora peripheral can occupy that slot at a time.

---

## Usage

### Keyboard Bindings

**Turtle control** (active when a computer panel is selected and no text input is focused):

| Key | Action |
|-----|--------|
| W | Move forward |
| S | Move back |
| A | Turn left |
| D | Turn right |
| Q | Move down |
| E | Move up |
| Del | Clear command queue |

**3D view camera:**

| Key | Action |
|-----|--------|
| Arrow Up | Pan camera forward |
| Arrow Down | Pan camera backward |
| Arrow Left | Pan camera left |
| Arrow Right | Pan camera right |

### User Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Approve/deny computer IPs and IDs, manage operators, send raw Lua, full access |
| **Operator** | Send predefined commands, view world map, manage inventory |
| **Guest** | Read-only live view; cannot send commands |

On first connection a computer's IP is held pending admin approval. Approved IPs persist to disk.

### Tips

- Double-clicking a block in the 3D view sends the selected turtle a pathfinding command to navigate there
- Clicking a block shows its name and coordinates in the overlay
- Clicking a chest adjacent to a connected turtle opens its inventory for drag-and-drop interaction
- If a turtle leaves chunk range its running program is interrupted; it restarts and reconnects when the chunk reloads

---

## Pre-made Turtle Programs

Several Lua programs are served by the app and can be downloaded from within a turtle. Originally from [exa-byte/CCTurtleRemoteController](https://github.com/exa-byte/CCTurtleRemoteController).

```lua
wget http://<APP_URL>/lua/turtle/programs/<program>.lua
```

| Program | Description |
|---------|-------------|
| `miningTunnel2.lua` | Two-wide branch mining tunnel |
| `miningTunnel3.lua` | Three-wide branch mining tunnel |
| `treeMiner.lua` | Tree felling |
| `veinMiner.lua` | Ore vein following |
| `stairsToLava.lua` | Staircase mining down to lava level |
| `placeNewTurtle.lua` | Places and registers a new turtle |
| `randomExplore.lua` | Random walk exploration |
| `skynetExpander.lua` | Automated network expansion |

The mining and tree programs share a helper library, `miner_utils.lua`, which handles vein-traversal logic. It is downloaded automatically by the turtle startup script, so any connected turtle already has it. If you need it on a standalone turtle:

```lua
wget http://<APP_URL>/lua/turtle/miner_utils.lua
```

---

## Further Reading

- [docs/textures.md](docs/textures.md) — texture extraction, block lookup, fixing missing/wrong textures, sprite sheets, custom assets
- [docs/deployment.md](docs/deployment.md) — authentication setup, packaged distribution, local vs production modes

---

<a href="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/Render%20Traversal.gif"><img src="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/Render%20Traversal.gif" width="100%"></a>
