> This is the canonical index for all detailed system documentation.
> `CLAUDE.md` contains project overview, tech stack, and roadmap.
> Everything else — how systems work, why they were designed that way, what connects to what — lives here.

## Usage Rules

1. When working on a system, read that system's doc before touching code.
2. When `CLAUDE.md` says "see library", this index routes you.
3. When you finish a task that changes a system, check the doc's `Update Triggers` section and update any stale content before closing.

---

## Game Systems

| Doc | What It Covers | Key Connections |
|---|---|---|
| [`scenes.md`](scenes.md) | Scene pipeline: BootScene textures, LobbyScene UI/lobby, GameScene init and update order, HUD layout, depth layers | `map.md`, `entities.md`, `builder.md`, `network.md` |
| [`map.md`](map.md) | Tile definitions, terrain data structure, road bitmask, `.bmap` parsing, `setTile`, wall damage chain | `scenes.md`, `entities.md` |
| [`entities.md`](entities.md) | Tank stats/movement/death, GhostTankManager interpolation, Pillbox AI/health/capture, BulletManager pool/collisions, mines | `map.md`, `builder.md`, `network.md` |
| [`builder.md`](builder.md) | Builder soldier state machine, ActionPanel actions and costs, world click handler, base resupply and capture | `entities.md`, `map.md`, `network.md` |
| [`network.md`](network.md) | NetworkManager singleton, GhostTankManager, server architecture, full C2S/S2C event protocol, RoomSettings, kill attribution, win conditions | `scenes.md`, `entities.md` |

## Infrastructure

| Doc | What It Covers |
|---|---|
| [`decisions.md`](decisions.md) | Architectural and design decisions with rationale — includes deployment decisions (Cloudflare Workers, wrangler.jsonc, Lightsail nginx) |

---

## Agent Ownership Map

| Doc | Owner / Responsible Role |
|---|---|
| `scenes.md` | Agent working on scene pipeline, BootScene textures, LobbyScene UI, or GameScene init |
| `map.md` | Agent working on map loading, tile types, or terrain mutation |
| `entities.md` | Agent working on Tank, Pillbox, Bullet, GhostTankManager, or mine behavior |
| `builder.md` | Agent working on builder mechanic, ActionPanel, or base logic |
| `network.md` | Agent working on multiplayer: NetworkManager, server, socket events, lobby, win conditions |
| `decisions.md` | Any agent making a significant architectural decision |
| This index | Any agent that adds a new doc |

---

## Adding a New Doc

1. Create `library/<system>.md` (Overview, Design Intent, [data/behavior sections], Connects To, Update Triggers).
2. Add a row to the correct table above.
3. Add `Update Triggers` to the new doc.
4. Add the doc to the owning agent's row in the ownership map.
5. Add a routing row in `CLAUDE.md` if appropriate.
