# 🍺 Drunk Alley Dash

A 3D multiplayer browser game for up to 4 players. Drunk guys stagger around a
dirty Vilnius back alley and compete to grab the most booze before the 2-minute
timer runs out. Alus 🍺 is worth 1 point, vynas 🍷 is 2, degtinė 🥃 is 3.

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

**Cars:** the alley opens onto a small city — a few blocks of streets. One
car per player is parked at the alley exit. Walk up to a free one and press
**E** (or tap the **🚗** button) to hop in, drive the streets — the car pulls
side to side, you're drunk — and press **E** / tap **🚪** to get out. Driving
is faster and collects bottles in a wider radius, but most bottles hide in
the alley on foot.

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
