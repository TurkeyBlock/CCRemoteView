# Deployment

## Authentication

**Dev mode** (`npm run dev`) disables authentication and binds only to `127.0.0.1` — network-unreachable by default with no firewall configuration required. To test the auth flow in dev, set `LOCAL_REQUIRE_AUTH = true` in `src/server/config.js`.

**Local mode** (packaged `start-local`) behaves identically: no auth, loopback-only binding. The two are always coupled — there is no configuration that disables auth while also exposing the server to the network.

**Production mode** (`npm run start` or packaged `start`) binds to all interfaces and enforces JWT authentication. Requires `APP_URL`, `NEXTAUTH_URL`, and `NEXTAUTH_SECRET` in `.env.local`. The server exits on startup if any are missing. Override the bind interface with `BIND_HOST` if you need a specific network adapter.

Production mode validates a JWT session cookie issued by an external [Auth.js](https://authjs.dev) instance. Set `NEXTAUTH_URL` and `NEXTAUTH_SECRET` in `.env.local` to match your auth server. This app only validates tokens — it does not handle sign-in itself.

Do not expose this server to the public internet without configuring authentication.

---

## Packaged distribution

`npm run pkg` produces a zip under `packaged/` containing a complete standalone server — Node.js binary, built Next.js frontend, Lua computer scripts, and blank starter data. No separate Node.js installation required.

> This package is not being distributed publicly; `npm run pkg` is provided so you can build your own.

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

### Extracting textures in a packaged build

Blocks render as solid colours without textures. To extract them from your Minecraft JAR before starting the server:

```
# Windows
build-textures.bat "C:\path\to\minecraft.jar" "C:\path\to\mods"

# Linux / macOS
./build-textures.sh "/path/to/minecraft.jar" "/path/to/mods"
```

See [textures.md](textures.md) for full extraction details and troubleshooting.
