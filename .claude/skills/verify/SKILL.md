---
name: verify
description: Build, launch, and drive Drunk Alley Dash end-to-end in headless Chrome, including the real 2-player PeerJS multiplayer flow.
---

# Verify Drunk Alley Dash

Node lives at `~/.local/opt/node/bin` (not on the default PATH):
`export PATH="$HOME/.local/opt/node/bin:$PATH"`.

## Build + serve

```sh
npm run build                      # tsc + vite build
npm run preview -- --port 4173 --strictPort   # serves dist/ (run in background)
```

## Drive it

Headless **Firefox has no WebGL** in this environment — even with
`webgl.force-enabled`. Use Puppeteer's Chrome with SwiftShader instead:

```js
puppeteer.launch({ headless: true, args: [
  '--no-sandbox', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader',
]})
```

Install puppeteer in the scratchpad, not in this project. A working full
driver script (2 browsers, create/join room, start round, keyboard movement,
scoring, disconnect probe) existed at `scratchpad/drive.mjs` in session
a00b27b8; recreate from this outline if gone:

1. Browser A: load page, set `#name-input` (optionally `#mode-select` to
   `night` — default is `day`; the host's choice must sync to joiners),
   click `#create-btn`, read the room code from `#room-code` once `#lobby`
   unhides (PeerJS cloud broker — needs internet, takes a few seconds).
2. Browser B: set `#code-input` to that code, click `#join-btn`; both
   `#player-list`s show 2 entries.
3. A clicks `#start-btn`; both pages: `#hud` unhides, `#scores .srow` count
   is 2 (no round timer exists).
4. Movement: `window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))`
   (+ matching keyup). Real key events also work; inputs must not be focused.
   Mobile: `page.emulate(KnownDevices['Pixel 5'])`; the joystick is a FIXED
   ring (`#stick`, right side above the 🚗 button, always visible during play
   on coarse-pointer devices). Read its center from
   `getBoundingClientRect()`, then `touchStart(cx, cy)` + `touchMove` from
   there — up = walk, sideways = turn; touches must START within ~130 px of
   the ring center or they're ignored.
5. Scoring: read `window.__dad` (debug handle: `pos`, `ry`, `car`, `driver`,
   `speed`, `trailer`, `bottles`, `cars`, `surface`, `alt`, `phase`,
   `obstacles`, `bums`, `roadkill`, `critterPos`, `drawCalls`, `hit()`,
   `roadPoint(t)`, plus `teleport(x, z, ry?)` and `spawnBum(x, z)` that only
   work with `?dev=1` in the URL) and steer W + A/D toward the nearest bottle
   until `.srow.me .pts` > 0; check the other browser's scoreboard agrees.
   Blind wandering no longer works — the map is alley + city and too big.
   There is no round timer; scores only ever climb.
6. The fleet (CAR_SPAWNS in `src/net/network.ts`): the RV at (0, 42) and the
   sedan+camper 'caravan' at (0, 56), both facing the gate; RV radius 1.85 —
   teleport ≥2.4 m from center or the pushout
   moves you. `#car-btn` unhides within 3.2 m → press E (or click it) →
   `__dad.car` non-null. Up to 4 aboard: occupants[0] drives (`__dad.driver`),
   the rest are window passengers pinned to the car; when the driver exits
   the next occupant is promoted. Use `?dev=1` + `__dad.teleport(x, z, ry?)`
   to skip walks — it moves the RV too while driving. It accelerates slowly:
   give drive-distance probes 14 s+ under SwiftShader.
7. Road trip: `__dad.obstacles` (9, host resets them per run), `__dad.surface`
   (city/asphalt/sand/gravel/mud/grass — use `__dad.roadPoint(t)` for on-road
   coords; the road is ~880 m, finish at z ~843), `__dad.alt` (terrain
   elevation — hills; expect a few meters of spread along the road),
   `__dad.phase`. Past the gate everyone is walled into the road corridor
   (`clampToRoadCorridor`, road half-width + 2 m) — driving around obstacles
   must FAIL. Most kinds clear proximity-based: stand within 6 m of an
   uncleared obstacle on foot → progress climbs, no key/button needed
   (solo 15 sim-secs — minutes of wall time under SwiftShader; use ~240 s
   timeouts). `bridge` (at RIVER_T ≈ 0.80) works the same but BUILDS a deck.
   `bumcamp` (t ≈ 0.68) is different: 3 block-mode bums spawn at round start
   (`__dad.bums`), each takes 3 stick hits (`__dad.hit()` beside them); the
   camp clears when all have fled. Win: drive the occupied RV past
   `roadPoint(0.99)` → phase `'won'`, `#won` overlay, host's `#again-btn`
   restarts. NOTE: on the host, `__dad`'s state flips before the next render
   frame — wait for DOM/overlay changes, don't read them instantly after a
   phase flip.
8. Disconnect probe: close browser B; A's scoreboard must drop to 1 row
   within ~5 s (heartbeat timeout in `src/net/peer.ts`).

## Gotchas

- Emoji render as tofu boxes in headless Chrome (no emoji font) — not a bug.
- Two flows share the PeerJS public broker; a flaky broker looks like a join
  timeout, not a code bug. Retry before concluding FAIL.
- `pkill -f` with any pattern that appears in your own compound command kills
  your own shell (exit 144). Use `pkill -x`.
- Two SwiftShader browsers contend for CPU; if states stall >8 s the client's
  heartbeat shows a "lost connection" notice. Rare flake — retry before
  concluding FAIL. (Never reintroduce `alert()` for this: it blocks the page.)
