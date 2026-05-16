# ComputerCraft Browser Interface

A browser-based remote control and live world map for ComputerCraft computers running on **Minecraft 1.12 (Tekkit2)**. View a real-time 3D render of the area around your computers and control turtles, minecarts, stationary computers, and player neural interfaces from a single browser interface.

![til](https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/FullPage.png)

<a href="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/TurtleControl.gif"><img src="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/TurtleControl.gif" width="49%"></a>
<a href="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/InventoryGUI.gif"><img src="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/InventoryGUI.gif" width="49%"></a>

---

## Features

- **Live 3D world map** — scanned blocks rendered in real time as instanced geometry, with extracted Minecraft textures and biome tinting
- **Multi-computer interface** — turtles, minecarts, stationary computers, and player neural interfaces managed from a single drag-and-drop panel UI
- **Command queue** — all commands are queued and executed in order; spamming a key queues every press rather than dropping inputs
- **Inventory management** — drag-and-drop turtle inventory slots, Ctrl+click to move whole stacks, fuel gauge, active slot display
- **Adjacent chest interaction** — clicking a chest next to a turtle in the 3D view opens its inventory as a GUI overlay; items can be dragged between the chest and the turtle's own inventory without any in-game input
- **Glasses HUD editor** — co-op browser canvas editor for `plethora:glasses`; draw rects, polygons, text, lines, item icons and groups on a 512×288 canvas with pixel-accurate Minecraft font preview; Live tab streams every edit directly to the player's HUD in real time; Draft tab supports undo/redo before publishing (requires Plethora neural interface + glasses module)
- **Lua terminal** — send arbitrary Lua directly to any connected computer (admin only)
- **Adjacent block inspection** — front/top/bottom blocks reported after every action without Plethora; full area scans require the Plethora scanner module
- **Entity detection** — scan nearby mobs and players (requires Plethora)
- **User roles** — admin, operator, and guest tiers; IP-based (and optional ID-based) computer approval
- **Persistent world state** — block and computer state saved to disk and restored on restart

---

## Requirements

- **Node.js 20+**
- **Minecraft 1.12** with [CC:Tweaked](https://tweaked.cc/) (or compatible ComputerCraft fork)
- **[Plethora Peripherals](https://plethora.madefor.cc/)** — required for block scanning, entity scanning, minecart computers, and player neural interfaces; basic turtle movement and inventory work without it
- HTTP access from ComputerCraft to the host machine (see [Minecraft setup](#minecraft-setup))

> **Minecraft version note:** This project targets 1.12 block data structures. Later versions significantly change how block state and metadata are stored; the underlying mechanics are stable but texture and block mapping aren't tested for versions 1.13+.

---

## Quick Start (Development)

```bash
npm install
npm run build-textures "<path/to/minecraft.jar>" "<optional: path/to/mods/>"
npm run dev
```

The interface is available at `http://localhost:8081`. Dev mode binds to `127.0.0.1` only and disables authentication — the server is unreachable from the network without any firewall configuration.

Texture extraction is optional — blocks render as solid colours without it. See [docs/textures.md](docs/textures.md) for platform-specific paths and troubleshooting.

---

## Production Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.local.example` to `.env.local` and fill in your values:

```bash
cp .env.local.example .env.local
```

At minimum, set `APP_URL` to the public address of the server. See [docs/deployment.md](docs/deployment.md) for authentication details.

### 3. Extract textures and font (optional)

```bash
npm run build-textures "<path/to/minecraft.jar>" "<optional: path/to/mods/>"
```

Extracts block/item textures for the 3D world map and the Minecraft bitmap font for pixel-accurate text preview in the glasses editor. Both are optional — the map renders as solid colours without textures, and the glasses editor falls back to a browser font without the font atlas.

### 4. Build and start

```bash
npm run build
npm run start
```

For packaged/standalone distribution, see [docs/deployment.md](docs/deployment.md).

---

## Minecraft Setup

ComputerCraft blocks HTTP to unlisted hosts by default. Add your host machine's IP
(or `localhost`) to the HTTP whitelist — in 1.12 this is `config/computercraft.cfg`;
in newer CC:Tweaked versions it's `<world>/serverconfig/computercraft-server.toml`.

Once the server is running, approve computer IPs through the Admin tab in the browser interface. Alternatively, edit `src/server/data/computer_ips.json` directly while the server is stopped.

---

## Adding Computers

Run the following in the in-game terminal, replacing `<APP_URL>` with your server's address:

| Computer type | Startup command | API functions |
|--------------|-----------------|---------------|
| Turtle | `wget run http://<APP_URL>/lua/turtle/startup` | [tapi](lua/turtle/tapi) |
| Minecart | `wget run http://<APP_URL>/lua/minecart/startup` | [mapi](lua/minecart/mapi) |
| Stationary | `wget run http://<APP_URL>/lua/stationary/startup` | [sapi](lua/stationary/sapi) |
| Player (neural interface) | `wget run http://<APP_URL>/lua/player/startup` | [papi](lua/player/papi) |

The startup script downloads the required files, registers with the server, and waits for IP approval from an admin in the browser interface. Once approved, the computer appears in the UI.

**Location:** On first boot a turtle attempts a GPS fix. If GPS is unavailable it falls back to a saved position, or prompts for manual entry in the format `x y z facing` (e.g. `-263 68 79 south`).

---

## Block Scanning & World Map

Full world map rendering requires a **Plethora scanner module** equipped on the turtle:

```lua
scan()   -- scans a 9×9×9 area centred on the turtle
```
In a turtle, using the LUA terminal in the browser, this would be accessible via tapi.scan().
'tapi', because that's the turtle's api file name, and 'scan()' because that's the function name with no vars.

For a minecart, this would be mapi.scan(), as minecarts use the 'mapi' api file. Etc.

Without a scanner, only the three blocks immediately adjacent to the turtle (front/top/bottom) are reported per command response.

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

---

## Keyboard Bindings

Active when a computer panel is selected and no text input is focused.

| Key | Action |
|-----|--------|
| W | Move forward |
| S | Move back |
| A | Turn left |
| D | Turn right |
| Q | Move down |
| E | Move up |
| Del | Clear command queue |

---

## User Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Approve/deny computer IPs and IDs, manage operators, send raw Lua, full access |
| **Operator** | Send predefined commands, view world map, manage inventory |
| **Guest** | Read-only live view via WebSocket; cannot send commands |

On first connection a computer's IP is held pending admin approval. Approved IPs persist to disk.

---

## Tips

- Double-clicking a block in the 3D view sends the selected turtle a pathfinding command to navigate there
- Clicking a block shows its name and coordinates in the overlay
- Clicking a chest adjacent to a connected turtle opens its inventory for drag-and-drop interaction
- If a turtle leaves chunk range its running program is interrupted; it restarts and reconnects when the chunk reloads
- turtle functions are set up assuming that a modem lives in the right hand and that the left hand is hot-swappable.

---
<a href="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/Render%20Traversal.gif"><img src="https://github.com/TurkeyBlock/CCRemoteViewImages/blob/main/Render%20Traversal.gif" width="100%"></a>

## Further Reading

- [docs/textures.md](docs/textures.md) — texture extraction, block lookup, fixing missing/wrong textures, sprite sheets, custom assets
- [docs/deployment.md](docs/deployment.md) — authentication setup, packaged distribution, local vs production modes

