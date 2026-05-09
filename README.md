# ComputerCraft Browser Interface

A browser-based remote control and live world map for ComputerCraft computers running on **Minecraft 1.12 (Tekkit2)**. View a real-time 3D render of the area around your computers and control turtles, minecarts, stationary computers, and player neural interfaces from a single browser interface.

> **Screenshot** — _to be added_

---

## Features

- **Live 3D world map** — scanned blocks rendered in real time as instanced geometry, with extracted Minecraft textures and biome tinting
- **Multi-computer interface** — turtles, minecarts, stationary computers, and player neural interfaces managed from a single drag-and-drop panel UI
- **Command queue** — all commands are queued and executed in order; spamming a key queues every press rather than dropping inputs
- **Inventory management** — drag-and-drop turtle inventory slots, Ctrl+click to move whole stacks, fuel gauge, active slot display
- **Adjacent chest interaction** — clicking a chest next to a turtle in the 3D view opens its inventory as a GUI overlay; items can be dragged between the chest and the turtle's own inventory without any in-game input
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

To test the authentication flow during development, set `LOCAL_REQUIRE_AUTH = true` in `src/server/config.js`. To change the dev port or auth server URL, edit `APP_PORT` / `DEV_APP_URL` / `DEV_AUTH_URL` in the same file.

Texture extraction is optional — blocks render as solid colours without it. See [Textures](#textures) for platform-specific paths and troubleshooting.

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

At minimum, set `APP_URL` to the public address of the server. See [Authentication](#authentication) for the `NEXTAUTH_*` variables.

### 3. Extract textures (optional)

```bash
npm run build-textures "<path/to/minecraft.jar>" "<optional: path/to/mods/>"
```

See [Textures](#textures) for platform-specific paths and troubleshooting.

### 4. Build and start

```bash
npm run build
npm run start
```

---

## Packaged Distribution

`npm run pkg` produces a zip under `packaged/` containing a complete standalone server — Node.js binary, built Next.js frontend, Lua computer scripts, and blank starter data. No separate Node.js installation required.

```bash
npm run pkg
```

(`npm run pkg` runs `npm run build` automatically first.)

After unzipping, choose your mode:

### Local mode (personal use, single machine)

Run `start-local.bat` (Windows) or `start-local.sh` (Linux/macOS).

Binds to `127.0.0.1` only and requires no authentication. Your Minecraft client and server must be on the same machine. No `.env.local` configuration needed.

### Production mode (shared or internet-facing)

1. Copy `.env.local.example` to `.env.local` and fill in `APP_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET`
2. Run `start.bat` (Windows) or `start.sh` (Linux/macOS)

Binds to all interfaces and enforces JWT authentication. The server will refuse to start with a clear error if any required variables are missing.

### Extracting textures (optional)

Blocks render as solid colours without textures. To extract them from your Minecraft JAR, run the texture extractor using the bundled Node.js binary before starting the server:

```
# Windows
node.exe server.js --build-textures "C:\path\to\minecraft.jar" "C:\path\to\mods"

# Linux / macOS
./node server.js --build-textures "/path/to/minecraft.jar" "/path/to/mods"
```

---

## Minecraft Setup

ComputerCraft blocks HTTP to unlisted hosts by default. Add your host machine's IP (or `localhost` if Minecraft and the Node server are on the same machine) to the HTTP whitelist in `<world>/serverconfig/computercraft-server.toml`.

Computer IP approval is also manageable through the Admin tab in the browser interface once the server is running.

---

## Adding Computers

Run the following in the in-game terminal, replacing `<APP_URL>` with your server's address:

| Computer type | Startup command |
|--------------|-----------------|
| Turtle | `wget run http://<APP_URL>/computers/turtle/startup` |
| Minecart | `wget run http://<APP_URL>/computers/minecart/startup` |
| Stationary | `wget run http://<APP_URL>/computers/stationary/startup` |
| Player (neural interface) | `wget run http://<APP_URL>/computers/player/startup` |

The startup script downloads the required files, registers with the server, and waits for IP approval from an admin in the browser interface. Once approved, the computer appears in the UI.

**Location:** On first boot a turtle attempts a GPS fix. If GPS is unavailable it falls back to a saved position, or prompts for manual entry in the format `x y z facing` (e.g. `-263 68 79 south`).

---

## Block Scanning & World Map

Full world map rendering requires a **Plethora scanner module** equipped on the turtle:

```lua
scan()   -- scans a 9×9×9 area centred on the turtle
```

Without a scanner, only the three blocks immediately adjacent to the turtle (front/top/bottom) are reported per command response.

---

## Textures

### Extraction

Block and item textures are not included for licence reasons. Extract them from your Minecraft JAR:

```bash
npm run build-textures "<path/to/minecraft.jar>" "<optional: path/to/mods/directory>"
```

On Windows with Tekkit2 (Technic Launcher):
```
npm run build-textures "C:\Users\<you>\AppData\Roaming\.technic\modpacks\tekkit-2\bin\minecraft.jar" "C:\Users\<you>\AppData\Roaming\.technic\modpacks\tekkit-2\mods"
```

For vanilla Minecraft:
```
npm run build-textures "%appdata%\.minecraft\versions\<version>\<version>.jar"
```

The extractor writes:

- `textures/blocks/{mod}/` — block face PNGs; subdirectory paths are flattened with underscores; some mods produce sprite sheets (a single PNG containing multiple block faces)
- `textures/items/{mod}/` — item sprites; blocks without a dedicated item sprite get a copy of their block face
- `textures/block-name-map.json` — the resolved mapping from block ID+metadata to texture file and geometry type

### How block lookup works

When the renderer needs to draw a block it looks up `mod:blockname:meta` through this priority chain:

1. **`geometryMap`** in `store/blockMaps/geometry.ts` — manual geometry override (wins over everything)
2. **`textureAliases`** in `store/blockMaps/textures.ts` — manual texture path override
3. **`block-name-map.json`** — auto-extracted texture + geometry from the JAR
4. **Bare name fallback** — strips metadata and tries `mod:blockname:0`
5. **Solid colour** — if nothing matches, the block renders as a flat grey cube

### What can go wrong with mod textures

The extractor walks each mod JAR's `assets/{mod}/blockstates/` and `assets/{mod}/models/block/` JSON files, resolves the texture and geometry automatically, then writes `block-name-map.json`. Several mod patterns break this:

- **Sprite sheets** — mods like IC2 and Railcraft pack many block faces into a single large PNG. The extractor can detect and save the sheet but can't know which tile corresponds to which block without a UV region.
- **Forge blockstate format** (`forge_marker: 1`) — stores textures inline in the blockstate JSON rather than a model file. The extractor handles the common case but misses some variants.
- **No blockstate file** — some mods register blocks without standard asset files. The extractor produces no entry for these.
- **1.12 metadata blocks** — 1.12 uses a single block name + metadata integer and does not natively provide a map to blocks' relevant textures. The extractor includes a large alias table for vanilla; mod aliases must be added manually.

### Fixing a missing or wrong texture

#### Wrong geometry (block looks like a flat square, solid cube, etc.)

Add an entry to the `geometryMap` object in `store/blockMaps/geometry.ts`:

```ts
export const geometryMap: { [blockId: string]: string } = {
  "yourmod:yourblock:0": "cross",   // or: cube, flat, slab_bottom, slab_top, leaves, pane
  "yourmod:yourblock":   "cross",   // applies to all metadata values
};
```

Available geometry types: `cube`, `cube6` (cube with 6 distinct face textures from a 96×16 horizontal strip — used for chests, for example), `cross` (plants/torches), `flat` (carpet/rails), `slab_bottom`, `slab_top`, `leaves`, `liquid`, `pane` (thin vertical centre column with up to 4 full-height arms toward adjacent panes and solid blocks — used for glass panes and iron bars), `fence` (thin centre post with up to 4 top + bottom rail pairs toward adjacent fences and solid blocks; covers walls too), `cable` (small centre cube with up to 6 arms toward neighbours that share a connection group — used for power cables, fluid pipes, item pipes), `stairs`. Note that `stairs` is not yet rendered with its true shape — blocks assigned this type render as cubes but correctly avoid hiding the faces of adjacent blocks.

#### Connection groups (cable / pipe wiring)

Cable geometry doesn't connect by shape — it connects by *connection group*. RF cables, EU cables, fluid pipes, and item pipes each have their own group (`"rf"`, `"eu"`, `"liquid"`, `"item"`). A cable extends an arm toward any neighbour that shares at least one of its groups, including non-cable acceptors (e.g. a chest is in the `"item"` group so item pipes attach to it).

Each group can also be subdivided into **sub-protocols** when two networks shouldn't merge — for example IC2 EU cables and Galacticraft aluminium wires are both EU but mechanically incompatible. In `store/blockMaps/connections.ts`, the group definitions are subgroup maps:

```ts
const EU = {
  ic2:      ["ic2:blockcable", ...],            // tag: "eu_ic2"
  galactic: ["galacticraftcore:aluminum_wire"], // tag: "eu_galactic"
  _:        ["ic2:blockmachinehv", ...],         // universal: gets BOTH sibling tags
};
const LIQUID = {
  _: [...],   // only "_" present → tag is just "liquid"
};
```

The `"_"` key has two meanings depending on context:
- **When named subgroups exist alongside `_`** (e.g. EU above): blocks under `_` are *universal acceptors* — they get every named sibling's tag and connect to all sub-protocols.
- **When `_` is the only key** (e.g. LIQUID above): the group has no subdivision and `_` entries get the bare prefix tag.

Blocks in different named sub-protocols don't connect to each other. Multi-group entries in `CONNECTION_GROUPS_OVERRIDES` (also in `connections.ts`) reference the resolved tag names (e.g. `["eu_ic2", "eu_galactic", "item"]`).

#### Wrong or missing texture (block is grey or shows a different block's face)

Add an entry to `textureAliases` in `store/blockMaps/textures.ts`. The value is a path relative to `textures/blocks/`, without the `.png` extension:

```ts
export const textureAliases: { [id: string]: string } = {
  "yourmod:yourblock:0": "yourmod/your_texture_filename",
  // Points to textures/blocks/yourmod/your_texture_filename.png
};
```

To find available texture filenames, look in `textures/blocks/{mod}/` after running the extractor. If the file isn't there, the mod JAR may not have written it — copy or rename one manually.

#### Block needs a colour tint (grass, leaves, dyed blocks)

Add an entry to `blockTint` in `store/blockMaps/tinting.ts`:

```ts
export const blockTint: { [id: string]: number } = {
  "yourmod:yourleaves": BIOME_TINT,  // standard green biome colour
  "yourmod:yourblock:3": 0xFF0000,   // arbitrary hex colour
};
```

`BIOME_TINT` (also exported from `tinting.ts`) is the standard grass/leaves green `0x88C149`.

#### Transparent block shows black faces on neighbours

The renderer skips drawing faces between two adjacent solid cubes for performance. If a transparent block is classified as solid, the faces behind it disappear. Add it to the non-occluding list in `store/blockMaps/occlusion.ts`:

```ts
// Pattern match (catches all blocks whose name contains "glass"):
const NON_OCCLUDING_PATTERNS: readonly string[] = [
  "glass",
  "yourmod_transparent_keyword",
];

// Or exact match for one-offs:
const NON_OCCLUDING_EXACT = new Set<string>([
  "yourmod:yourblock",
]);
```

### Sprite sheet workflow

Some mods store all their block faces in a single large PNG (a sprite sheet) rather than individual files. The extractor saves the whole sheet as one file; you must tell the renderer which sub-region to use.

**Step 1 — find the sheet file.** After running the extractor, check `textures/blocks/{mod}/`. Sprite sheets often have names like `sprites_block_0.png` or `brick_sandy.png` that are obviously larger than 16×16.

**Step 2 — identify the tile.** Open the image in any editor. Tiles are typically 16×16 pixels laid out in a grid. Count columns from the left and rows from the top (both zero-indexed) to find the tile for your block. The UV coordinates are:

```
u1 = col  * 16      v1 = row * 16
u2 = (col + 1) * 16  v2 = (row + 1) * 16
```

**Step 3 — add the entries to `store/blockMaps/textures.ts`.** Both `textureAliases` (the sheet file) and `uvOverrides` (the pixel region) must be set:

```ts
export const textureAliases: { [id: string]: string } = {
  "yourmod:yourblock:0": "yourmod/sprites_block_0",  // the sheet PNG, no .png
};

export const uvOverrides: Record<string, [number, number, number, number]> = {
  "yourmod:yourblock:0": [32, 16, 48, 32],  // [u1, v1, u2, v2] in pixels
};
```

UV coordinates are **pixel offsets into the PNG** matching its actual dimensions, not normalised 0–1 values.

### Custom textures

For blocks that the extractor can't handle (e.g. vanilla `minecraft:chest`, which uses a block-entity renderer and has no standard block model), you can supply your own PNG assets and wire them up manually.

1. Create a named folder under `textures/` — for example `textures/chest/`. Do **not** use `blocks`, `items`, or `turtle` (those are reserved).
2. Place your PNG files in it. Any layout is fine; subdirectories work too.
3. At the end of every `npm run build-textures` run, the extractor automatically copies those folders into `textures/blocks/` (e.g. `textures/blocks/chest/`). They can then be referenced via `textureAliases` or `block-name-map.json` using the path `"blocks/chest/your_file"` — the same scheme as any other extracted texture.
4. The source folder is never overwritten by the extractor, so your files are safe.

For per-face textures (each cube face drawing from its own tile), use the `cube6` geometry type — supply a 96×16 PNG with tiles in the order `+X, -X, +Y, -Y, +Z, -Z`. For other custom shapes, add a new geometry type to the `geomType` handling in `workers/chunkBuilder.worker.ts` and reference it from `geometryMap` or `block-name-map.json`.

---

## Pre-made Turtle Programs

Several Lua programs are served by the app and can be downloaded from within a turtle:

```lua
wget http://<APP_URL>/computers/turtle/programs/<program>.lua
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
| **Guest** | Read-only; world state queries rate-limited to one per 30 seconds |

On first connection a computer's IP is held pending admin approval. Approved IPs persist to disk.

---

## Authentication

**Dev mode** (`npm run dev`) disables authentication and binds only to `127.0.0.1` — network-unreachable by default with no firewall configuration required. To test the auth flow in dev, set `LOCAL_REQUIRE_AUTH = true` in `src/server/config.js`.

**Local mode** (packaged `start-local`) behaves identically: no auth, loopback-only binding. The two are always coupled — there is no configuration that disables auth while also exposing the server to the network.

**Production mode** (`npm run start` or packaged `start`) binds to all interfaces and enforces JWT authentication. Requires `APP_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` in `.env.local`. The server exits on startup if any are missing. Override the bind interface with `BIND_HOST` if you need a specific network adapter.

**Production mode** validates a JWT session cookie issued by an external [Auth.js](https://authjs.dev) instance. Set `NEXTAUTH_URL` and `NEXTAUTH_SECRET` in `.env.local` to match your auth server. This app only validates tokens — it does not handle sign-in itself.

Do not expose this server to the public internet without configuring authentication.

---

## Misc

- Double-clicking a block in the 3D view sends the selected turtle a pathfinding command to navigate there
- Clicking a block shows its name and coordinates in the overlay
- Clicking a chest adjacent to a connected turtle opens its inventory for drag-and-drop interaction
- Commands queue — spamming a key queues every press; clear the queue with `Del`
- If a turtle leaves chunk range its running program is interrupted; it restarts and reconnects when the chunk reloads
