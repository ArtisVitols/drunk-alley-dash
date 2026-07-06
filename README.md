# 🍺 Drunk Alley Dash

A 3D multiplayer browser game for up to 4 players. Drunk guys stagger around a
dirty night alley and compete to grab the most booze before the 2-minute timer
runs out. Beer 🍺 is worth 1 point, wine 🍷 is 2, vodka 🥃 is 3.

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
