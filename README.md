# ComputerCraft Browser Interface

A browser-based remote control and live world map for ComputerCraft computers running on **Minecraft 1.12 (Tekkit2)**. View a real-time 3D render of the area around your computers, control turtles from the browser, and route commands to any number of machines across your server via modem relay.

> **Screenshot** — _to be added_

---

## Features

- **Live 3D world map** — scanned blocks rendered in real time as instanced geometry, with extracted Minecraft textures and biome tinting
- **Modem relay** — one HTTP-connected computer acts as a hub, batching and forwarding commands to any number of computers, reducing update queries to and from hosting server(s).
- **Multi-computer interface** — turtles, minecarts, stationary computers, and player neural interfaces managed from a single (or multiple!) drag-and-drop panel UI
- **Command queue** — all commands are queued and executed in order; spamming a key queues every press rather than dropping inputs
- **Inventory management** — drag-and-drop slots, Ctrl+click to move whole stacks, fuel gauge, active slot display
- **Lua terminal** — send arbitrary Lua directly to any connected computer
- **Adjacent block inspection** — front/top/bottom blocks reported following every action without Plethora; full area scans require the Plethora scanner module
- **Entity detection** — scan nearby mobs and players (requires Plethora)
- **User roles** — admin, operator, and guest tiers within the interface. IP and optional ID based computer approval for incoming computercraft information.
- **Persistent world state** — block and computer state saved to disk and restored on restart.

---

## Requirements

- **Node.js** 18+
- **Minecraft 1.12** with [CC:Tweaked](https://tweaked.cc/) (or compatible ComputerCraft fork)
- **[Plethora Peripherals](https://plethora.madefor.cc/)** — required for block scanning, entity scanning, minecart computers, and player neural interfaces; basic turtle movement and inventory control work without it
- HTTP access from ComputerCraft to the host machine (see [Minecraft setup](#minecraft-setup))

> **Minecraft version note:** This project targets 1.12 block data structures. Later versions significantly change how block state and metadata are stored. The underlying mechanics (command queue, modem relay, inventory, world rendering) are stable, but texture/block mapping will not work correctly on 1.13+ worlds.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env.local` file in the project root:

```env
# Production/public only — APP_URL defaults to http://localhost:8081 in dev mode
APP_URL="http://192.168.x.x:8081"

# Port to listen on (default: 8081)
APP_PORT=8081

# Production/public only — see Authentication section
# NEXTAUTH_URL="https://yourdomain.com"
# NEXTAUTH_SECRET="<openssl rand -base64 32>"
```

**Local / LAN use:** Dev mode disables authentication and defaults `APP_URL` to `http://localhost:8081` — no `.env.local` is required to get started if Minecraft is on the same machine. For a separate Minecraft server on your LAN, set `APP_URL` to your host machine's LAN IP (e.g. `http://192.168.x.x:8081`).

**Public deployment:** Configure JWT authentication before exposing the server to the internet. See [Authentication](#authentication).

### 3. Build the frontend

```bash
npm run build
```

### 4. Start the server

**Development (no auth, hot reload):**
```bash
npm run dev
```

**Production:**
```bash
npm run start
```

The interface is available at `http://localhost:8081` (or your configured `APP_PORT`).

---

## Minecraft Setup

This is configurable through the server browser under the Admin tab. For pre-setup, do the following:

ComputerCraft blocks HTTP to unlisted hosts by default. Allow your host machine in the server config at `<world>/serverconfig/computercraft-server.toml` by adding your host IP or `localhost` to the HTTP whitelist.

For a local setup where Minecraft and the Node server run on the same machine, allowing `localhost` is sufficient.

---

## Adding Computers

### Turtles

Run this in the turtle's terminal, replacing `<APP_URL>` with the value from your `.env.local`:

```
wget run http://<APP_URL>/computers/turtle/startup
```

The startup script downloads the required files, registers with the server, and waits for IP approval from an admin. Once approved, the turtle appears in the browser interface.

**Location:** On first boot the turtle attempts a GPS fix. If GPS is unavailable it falls back to a saved position, or prompts for manual coordinates in the format `x y z facing` (e.g. `-263 68 79 south`).

### Other computer types

| Type | Startup URL |
|------|------------|
| Minecart | `http://<APP_URL>/computers/minecart/startup` |
| Modem relay | `http://<APP_URL>/computers/modem/startup` |
| Stationary | `http://<APP_URL>/computers/stationary/startup` |
| Player (neural interface) | `http://<APP_URL>/computers/player/startup` |

---

## Modem Relay (optional)

Computers without direct HTTP access can be reached through a **modem relay**: one computer registers as the relay hub, and all others auto-discover it via wireless modem (A crafted in-game item peripheral) on startup. Set up the relay computer using the modem startup URL above, and add other computers normally. This can be done in any order, though there may be a delay as all computers register the change.

This is the recommended setup for larger networks — though all computers will send command responses via http, only one will need to send update requests to the webserver; the rest communicate ingame-wirelessly through the hub.

Every connected computer will need their own wireless modem item to communicate.

---

## Block Scanning & World Map

Full world map rendering effectively requires a **Plethora scanner module** equipped on the turtle:

```lua
scan()  -- scans a 9x9x9 area centred on the turtle and sends block data to the server
```

Without a scanner, only the three blocks immediately adjacent to the turtle (front/top/bottom) are reported per command response.

---

## Textures

Block and item textures are not included for license reasons. Extract them from your Minecraft installation JAR:

```bash
npm run build-textures "<path/to/minecraft.jar>" "<optional: path/to/mods/directory>"
```

On Windows with Tekkit2 (Technic Launcher):
```
npm run build-textures "C:\Users\<you>\AppData\Roaming\.technic\modpacks\tekkit-2\bin\minecraft.jar" "C:\Users\<you>\AppData\Roaming\.technic\modpacks\tekkit-2\mods"
```

For vanilla Minecraft the JAR is typically at:
```
%appdata%\.minecraft\versions\<version>\<version>.jar
```

Run the command until it completes without errors — this may take 2–3 passes. Textures are written to `textures/blocks/` and `textures/items/`. Mod textures land in subdirectories named after their mod namespace (e.g. `textures/blocks/plethora/`).

If the renderer shows untextured blocks, the texture files are simply absent — it falls back to solid colours.

---

## Keyboard Bindings

Active when a computer is selected and no text input is focused.

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
| **Admin** | Approve/deny computer IPs, manage operators, full access |
| **Operator** | Send commands, view world, manage inventory |
| **Guest** | Read-only; state queries rate-limited to one per 30 seconds |

On first connection a computer's IP is held pending admin approval. Approved IPs are persisted to disk.

---

## Authentication

**Dev mode** (`npm run dev`) disables authentication. Suitable for local or trusted-LAN use only — do not port-forward a dev instance.

**Production mode** validates a JWT session cookie issued by an [Auth.js](https://authjs.dev) instance at `NEXTAUTH_URL`. The `NEXTAUTH_SECRET` must match between the auth server and this app. This server only validates the token and can reasonably be configured to handle any auth's token, it does not handle sign-in itself.

Do not expose this server to the public internet without configuring authentication.

---

## Pre-made Turtle Programs

Several Lua programs are served by the app and can be downloaded from within a turtle:

```lua
wget http://<APP_URL>/turtlePrograms/<program>.lua
```

| Program | Description |
|---------|-------------|
| `miningTunnel2.lua` | Two-wide branch mining tunnel |
| `miningTunnel3.lua` | Three-wide branch mining tunnel |
| `treeMiner.lua` | Tree felling |
| `veinMiner.lua` | Ore vein following |
| `randomExplore.lua` | Random walk exploration |
| `skynetExpander.lua` | Automated network expansion |

---

## Misc

- Double-clicking a block in the 3D view sends the selected turtle a pathfinding command to move there
- Clicking a block shows its ID and coordinates in the overlay
- Clicking a chest adjacent to a turtle opens its inventory, which may be interacted with.
- Commands queue up — spamming a key queues every press. Clear the queue with `Del`
- If a turtle leaves chunk range its running program is interrupted; it restarts and reconnects when the chunk reloads

---

## Development

```bash
npm run dev
```

The server starts with Next.js hot reload at `http://localhost:8081`.

To simulate a turtle locally without Minecraft:

```bash
npm run test:turtle
```
