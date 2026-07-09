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

Controls: **W/S** move forward/back, **A/D** turn (arrows work too), **E**
hops in/out of vehicles, **SPACE** (or **F**) swings your stick. On
**phones/tablets** (the primary way to play) a joystick ring sits on the
right side of the screen, always visible above the 🚗 button: up/down walks
or drives, left/right turns. It ignores tiny thumb wobble (deadzone),
smooths the input, and gives finer steering near the center. The 🏏 **Whack**
button lives under your left thumb whenever you're on foot.
Walking drunk means your heading drifts on its own — deal with it.

**The bums (bomžai):** waves of stinky drifters shamble out of the shadows
and cling to your vehicles, banging on the doors — a besieged vehicle can't
drive until someone gets out and beats them off. Every drunk carries a
whacking stick: three hits and a bum sprints away screaming. It's a team
job — anyone's hits count.

**Roadkill:** the stray cats, dogs, squirrels and raccoons wandering the
streets and the country road get flattened if you drive over them fast
enough — the camper counts too. No points, just consequences.

**The rides:** the alley opens onto a small city — a few blocks of streets —
and on the main street waits the team's fleet: a beat-up cab-over **RV**, and
parked ahead of it a green **sedan towing a camper**. Each seats a 4-player
crew. Walk up and press **E** (or tap the **🚗** button) to hop in; press
**E** / tap **🚪** to get out. The first one in drives (invisible — busy
steering), everyone else hangs out of the windows waving their bottles — in
the caravan the passengers ride in the camper, and you can board straight
from the camper door. If the driver bails, the next passenger inherits the
wheel. Only the driver and walkers collect bottles — driving grabs them in a
wider radius, but most bottles hide in the alley on foot.

**Towing:** the camper is properly articulated — it swings wide in corners,
settles in behind you on the straights, and folds toward the hitch stop when
you reverse (backing up a trailer is exactly as hard as in real life). The
camper hits things too: clip a wall with it and the whole rig crunches.

**Dashboard & atmosphere:** aboard the RV you get a working speedometer and
tachometer; a fully synthesized soundscape (WebAudio, no audio files) covers
the engine, pickups, crashes, doors, clearing knocks, a ROUTE 65 fanfare,
drunken hiccups, birds by day and crickets by night — mute with the 🔊
button. Stray cats, dogs, squirrels and raccoons dart across the streets and
the country road, and the alley has its rats.

**The road to ROUTE 65 (co-op):** the city's north gate opens onto a winding
**~880 m** country road that **climbs and dips over rolling hills**, the
surface degrading as you go — asphalt, then a sandy track, then loose
gravel, and finally wet mud past the river, each slower and more swervy than
the last. A dense **wall of pines** hems the road in on both sides: there is
no driving around anything. The jobs along the way:

- **Junk** — roadblocks, fallen logs, boulder piles: hop out and **stand at
  the obstacle**; your drunk gets to work automatically and a progress panel
  fills, much faster together (solo ~15 s, full crew ~4 s).
- **Dead animals** — a moose and boars sprawled across the lane (crows
  included); drag them aside the same way.
- **A bum camp** squatting on the road around a barrel fire — no shovel work
  here: each of the three squatters takes **three stick hits** before he
  runs, and the road only opens when they're all gone.
- **The river** — the team must **build a plank bridge** (same stand-and-work
  mechanic); the finished deck runs along the road, wide enough for the RV.

A distance readout counts down to the **ROUTE 65** junction. Get the RV
there with someone aboard and the run is won — the host can start a fresh
run from the victory screen. Bottles are strewn along the route, so keep
gathering.

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
