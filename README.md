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
On **phones/tablets** (the primary way to play) there are three touch
schemes — a small button in the top-right corner cycles through them and
your choice is remembered:

- **🕹 Joystick** — drag anywhere and a stick appears under your thumb:
  up/down walks or drives, left/right turns.
- **👉 Point to go** — drag in the direction you want to go (relative to
  the camera); your drunk turns and heads that way himself. Driving, the
  RV steers toward where you point — point behind it to reverse.
- **🎮 Two thumbs** — left half of the screen is gas (slide up/down),
  right half is steering (slide sideways). Best for the road trip.

All schemes ignore tiny thumb wobble (deadzone), smooth the input, and
give finer steering near the stick's center.
Walking drunk means your heading drifts on its own — deal with it.

**The RV:** the alley opens onto a small city — a few blocks of streets — and
on the main street waits the team's one and only vehicle: a beat-up cab-over
**RV** that seats the whole 4-player crew. Walk up and press **E** (or tap the
**🚗** button) to hop in; press **E** / tap **🚪** to get out. The first one in
drives (invisible — busy steering), everyone else hangs out of the windows
waving their bottles. If the driver bails, the next passenger inherits the
wheel. Only the driver and walkers collect bottles — driving grabs them in a
wider radius, but most bottles hide in the alley on foot.

**Dashboard & atmosphere:** aboard the RV you get a working speedometer and
tachometer; a fully synthesized soundscape (WebAudio, no audio files) covers
the engine, pickups, crashes, doors, clearing knocks, a ROUTE 65 fanfare,
drunken hiccups, birds by day and crickets by night — mute with the 🔊
button. Stray cats, dogs, squirrels and raccoons dart across the streets and
the country road, and the alley has its rats.

**The road to ROUTE 65 (co-op):** the city's north gate opens onto a winding
country road that **climbs and dips over rolling hills** — asphalt at first,
then a sandy track through green fields. A dense **wall of pines** hems the
road in on both sides: there is no driving around anything. The road is
blocked by junk — roadblocks, fallen logs, boulder piles — so the team hops
out and **stands at the obstacle**; your drunk gets to work automatically and
a progress panel fills, much faster together (solo ~15 s, full crew ~4 s).
Sand makes the drunk swerving worse, and a distance readout counts down to
the **ROUTE 65** junction. Get the RV there with someone aboard and the run
is won — the host can start a fresh run from the victory screen. Bottles are
strewn along the route, so keep gathering.

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
