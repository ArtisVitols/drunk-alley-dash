# 🍺 Drunk Alley Dash

A 3D multiplayer browser game for up to 4 players. Drunk guys stagger around a
dirty Vilnius back alley and compete to grab the most booze — no timer, the
session just keeps going and the counters keep climbing. Alus 🍺 is worth
1 point, vynas 🍷 is 2, degtinė 🥃 is 3.

When creating a room the host picks the time of day — a bright Baltic
afternoon (default) or the neon-lit night — and every joiner gets the same
scene. Į sveikatą!

Built with [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/).
Multiplayer is peer-to-peer over WebRTC ([PeerJS](https://peerjs.com/)) — one
player's browser hosts the room, so the whole game is static files with no
game server.

## Play

One player clicks **Create room** and shares the 4-letter code; up to 3 friends
enter it and **Join**. The host starts the round (solo works too).

Controls: **W/S** move forward/back, **A/D** turn (arrows work too).
On **phones/tablets**, drag anywhere on the screen — a floating joystick
appears under your thumb (up/down walks, left/right turns).
Walking drunk means your heading drifts on its own — deal with it.

**Cars:** the alley opens onto a small city — a few blocks of streets. Four
rides are always parked at the alley exit: a nimble **sedan**, a boxy **van**,
a lumbering **RV**, and a **pickup truck** with an open bed — each drives
differently, and they collide with each other (and with you). Walk up and
press **E** (or tap the **🚗** button) to hop in; press **E** / tap **🚪** to
get out. Up to 4 people fit in one car: the first in drives (invisible — busy
steering), everyone else hangs out of the windows waving their bottles (truck
passengers party standing in the bed). If the driver bails, the next passenger
inherits the wheel. Only drivers and walkers collect bottles — driving grabs
them in a wider radius, but most bottles hide in the alley on foot.

**The road to ROUTE 65 (co-op):** the city's north gate opens onto a winding
country road — asphalt at first, then a sandy track through green fields and
pines. The road is blocked by junk: roadblocks, fallen logs, boulder piles.
The team hops out and **holds E / the 🛠 button** at an obstacle to clear it —
much faster together (solo ~15 s, full crew ~4 s). Off-road grass bogs cars
down, sand makes the drunk swerving worse, and a distance readout counts down
to the **ROUTE 65** junction. Get any occupied vehicle there (the RV fits the
whole team) and the run is won — the host can start a fresh run from the
victory screen. Bottles are strewn along the route, so keep gathering.

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
```

To test multiplayer locally, open the dev URL in two browser windows.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via
`.github/workflows/deploy.yml`.
