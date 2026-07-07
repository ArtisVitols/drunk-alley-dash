# Drunk Alley Dash

3D multiplayer browser game (up to 4 players): drunk guys collect booze in a
Vilnius alley + drivable city, sharing 4 vehicles. Three.js + Vite + TypeScript,
P2P multiplayer over PeerJS (no server). Live at
https://artisvitols.github.io/drunk-alley-dash/ — repo `ArtisVitols/drunk-alley-dash`.

## Commands

Node lives at `~/.local/opt/node/bin` and is NOT on PATH — prefix every command:

```sh
export PATH="$HOME/.local/opt/node/bin:$PATH"
npm run dev                                  # dev server
npm run build                                # tsc + vite build (must stay clean)
npm run preview -- --port 4173 --strictPort  # serve dist/ for verification
```

Deploy = push to `main`; GitHub Actions builds and publishes to Pages
(`.github/workflows/deploy.yml`). Verify the served JS hash matches `dist/assets/`
before testing production — the Pages CDN caches HTML up to ~10 min (bust with `?v=<ts>`).

## Architecture

- **Host-authoritative P2P**: the room creator's browser runs the only simulation
  (`src/game/host.ts`, `HostSim`). Clients send input/pose at ~15 Hz; the host
  broadcasts the full `WorldState` at ~15 Hz. All message/state types live in
  `src/net/network.ts`; the PeerJS transport in `src/net/peer.ts` (room code =
  PeerJS id suffix; heartbeat timeouts because PeerJS `close` is unreliable).
- **Movement is client-authoritative**: each player simulates himself
  (`LocalController` walking, `CarController` driving in `src/game/car.ts`) and
  reports positions; the host trusts drivers/walkers, pins passengers to cars,
  and resolves pickups/seats/scores.
- **Cars**: 4 kinds (sedan/van/rv/truck), always spawned, up to 4 occupants;
  `occupants[0]` drives (rendered invisible), the rest are window/bed passenger
  meshes (`syncCarPassengers`). Driver exit promotes the next occupant.
- **Scene** (`src/game/scene.ts`): built per day/night mode into a disposable
  group — `setMode` in `main.ts` swaps it live; players/bottles/FX live directly
  on the scene and survive. Collision = rectangular world bounds + AABB obstacle
  list (`collideCircle` in `src/game/player.ts`); no physics engine.
- **Rendering**: ACES + UnrealBloom + soft shadows, but `lofi` mode
  (auto-detected SwiftShader/llvmpipe, or `?fx=lo|hi`) disables bloom/shadows/rain.
  Merge static decor geometry (`mergeGeometries`) — SwiftShader dies by draw count.
- `main.ts` is the glue: input (WASD + floating touch joystick + context button),
  state→scene application, camera, HUD wiring (`src/game/hud.ts` ↔ `index.html`).

## Verification

Follow `.claude/skills/verify/SKILL.md`. Short version: headless Chrome via
Puppeteer (installed in the session scratchpad, NOT in this repo) with
`--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`; headless
Firefox has no WebGL here. Real multiplayer flows work headless through the
PeerJS public broker. `window.__dad` is the read-only test handle (pos/ry/car/
driver/speed/bottles/cars + `teleport(x,z)` gated behind `?dev=1`). Expect
~2-5 FPS under SwiftShader — sim runs slow-motion (dt clamp), so use generous
timeouts and distance thresholds; never leave stray `chrome` processes
(`pkill -x`-style patterns only, self-matching `pkill -f` kills your own shell).

## Conventions

- TypeScript strict; `npm run build` runs `tsc` — keep it error-free.
- All art is procedural (three.js primitives + canvas textures in
  `src/game/textures.ts`); no downloaded assets, game stays fully static.
- Lithuanian flavor is intentional (BARAS/ALUS neon, alus/vynas/degtinė scoring).
- No round timer — sessions are endless unless a mode says otherwise.
- Commit messages explain gameplay-level intent, not just code changes.
