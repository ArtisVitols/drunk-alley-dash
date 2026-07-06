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
3. A clicks `#start-btn`; both pages: `#hud` unhides, `#timer` shows `2:00`,
   `#scores .srow` count is 2.
4. Movement: `window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))`
   (+ matching keyup). Real key events also work; inputs must not be focused.
   Mobile: `page.emulate(KnownDevices['Pixel 5'])`, then
   `page.touchscreen.touchStart(x,y)` / `touchMove` / `touchEnd` drives the
   floating joystick (`#stick` unhides while dragging); drag up = walk,
   sideways = turn. A full phone-joins-desktop script outline lived at
   `scratchpad/mobile.mjs` in session a00b27b8.
5. Scoring: wander (W + random A/D bursts) until `.srow.me .pts` > 0
   (usually well under a minute); check the other browser's scoreboard agrees.
6. Disconnect probe: close browser B; A's scoreboard must drop to 1 row
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
