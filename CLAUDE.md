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
- **The fleet**: two vehicles (CAR_SPAWNS): the RV at (0, 42) and a
  'caravan' — a sedan towing a camper — at (0, 56). Up to 4 occupants each;
  `occupants[0]` drives (rendered invisible), the rest are window passenger
  meshes (`syncCarPassengers`; caravan passengers ride in the camper).
  Driver exit promotes the next occupant. Vehicle↔walker collision via
  circles (`collideCircles`); other car kinds' builders remain in `car.ts`
  but never spawn.
- **Towing** (`car.ts`): the camper is kinematic — its axle chases the hitch
  (`trailerRy += speed/TRAILER_LEN · sin(ry − trailerRy) · dt`, bend clamped
  to ±1.15 rad so reversing folds but never jackknifes through the car). The
  trailer is a second collision circle (`trailerCenterXZ`/`TRAILER_RADIUS`)
  that shoves the whole rig on impact. `CarState.tr` carries the trailer yaw
  over the network (drivers send it in 'pos'); boarding works from beside
  the camper too (host + client both check the trailer circle).
- **Road trip** (`src/game/road.ts` = shared curve/surface/elevation math,
  `src/game/obstacles.ts` = meshes/AABBs): the city gate opens onto a winding
  ~880 m road over hills to the ROUTE 65 finish (z ~843). Surfaces by
  arc-fraction: asphalt → sand → gravel (`GRAVEL_START_T`) → mud
  (`MUD_START_T`); gravel/mud shave top speed and add sway (car.ts). Terrain
  height = `elevation(x, z)` (flat in city, sine hills beyond; y is always
  derived client-side — the network still sends y = 0). `clampToRoadCorridor`
  walls everyone into the road corridor past the gate so vehicles can't
  drive around the 9 host-owned obstacles. Kinds: 5 classic (proximity-
  cleared: stand within 6 m on foot, more workers = faster), plus on the
  extension `carcass` (dead animals, proximity), `bridge` (river at
  `RIVER_T`; proximity work BUILDS the deck — cleared shows the 'built'
  child group instead of shoving aside), and `bumcamp` (3 block-mode bums
  spawned at round start; progress = squatters whacked, cleared when all
  flee — no proximity work). The RV past the finish with anyone aboard →
  `phase: 'won'`; host restart resets everything.
- **Scene** (`src/game/scene.ts`): built per day/night mode into a disposable
  group — `setMode` in `main.ts` swaps it live; players/bottles/FX live directly
  on the scene and survive. Collision = rectangular world bounds + AABB obstacle
  list (`collideCircle` in `src/game/player.ts`); no physics engine. The world
  is ~490 m long — shadows follow the local player (`focusShadow`).
- **Rendering**: ACES (exposure per mode: 1.1 day / 1.25 night) + UnrealBloom +
  soft shadows + one no-shadow fill light, but `lofi` mode (auto-detected
  SwiftShader/llvmpipe, or `?fx=lo|hi`) disables bloom/shadows/rain/god-rays.
  Merge static decor geometry (`mergeGeometries`) — SwiftShader dies by draw
  count; NOTE `IcosahedronGeometry` is non-indexed and cannot merge with
  indexed primitives. Canvas color textures double as bumpMaps (`toBump` in
  textures.ts); `carPaintTexture` is a shared wear layer tinted per vehicle;
  night-only extras (headlight beams via `setCarNight`, lamp light pools)
  toggle with the mode. `__dad.drawCalls` reports per-frame draw calls
  (day city view ≈ 270).
- **Audio** (`src/game/sound.ts`): everything synthesized with WebAudio (no
  files); context unlocks on first gesture. Engine loop follows the smoothed
  RPM from `src/game/gauges.ts` (canvas dials, shown while aboard). Ambient
  critters (`src/game/critters.ts`) are client-side only — never synced.
- **Touch controls** (`src/game/controls.ts`): one floating joystick (drag
  anywhere: up walks, sideways turns) with deadzone + expo + smoothing + a
  base that follows the thumb past the rim. Touch overrides keyboard while
  `controls.active`.
- **Bums** (`src/net/network.ts` `BumState`, host AI in `host.ts`, meshes in
  `src/game/bums.ts`): host-simulated stinky men/women spawn in waves
  (first ~8 s in, then every ~18-32 s, max 6), shamble to the nearest
  point of a vehicle (cab or camper) and cling banging on the door — a
  clung-to vehicle can't accelerate (driver's client zeroes throttle).
  Three stick hits → `mode: 'flee'`, they sprint off screaming and despawn.
  Whacking: the 🏏 `#hit-btn` (bottom-left, on-foot only) or SPACE/F swings
  the stick every drunk carries; a `swing` counter in PlayerState/'pos'
  (`sw`) carries the action — the host lands the hit on the nearest bum
  within 2.6 m, remotes replay the animation on counter change.
  `__dad.bums/hit()/spawnBum(x,z)` (latter ?dev=1 + host only) for tests.
- **Roadkill** (`critters.ts`): critters stay client-side, but any vehicle
  footprint (cab or towed camper, from `WorldState.cars` + the local
  `CarController`) moving >2.5 m/s squashes them flat; they lie pancaked
  for a few seconds. `__dad.roadkill` counts local kills.
- `main.ts` is the glue: input (WASD + touch schemes + context button),
  state→scene application, camera, HUD wiring (`src/game/hud.ts` ↔ `index.html`).

## Verification

Follow `.claude/skills/verify/SKILL.md`. Short version: headless Chrome via
Puppeteer (installed in the session scratchpad, NOT in this repo) with
`--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`; headless
Firefox has no WebGL here. Real multiplayer flows work headless through the
PeerJS public broker. `window.__dad` is the read-only test handle (pos/ry/car/
driver/speed/trailer/bottles/cars/surface/phase/obstacles/roadPoint(t) +
`teleport(x,z,ry?)` gated behind `?dev=1`, which moves the car too when
driving). Expect
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
