import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildScene, randomFreePos } from './game/scene';
import { PickupFX, Rain, Steam } from './game/fx';
import {
  LocalController,
  RemoteAvatar,
  applyWobble,
  collideCircle,
  createPlayerMesh,
  type Circle,
} from './game/player';
import type { Obstacle } from './game/scene';
import { BOTTLE_GLOW, createBottleMesh } from './game/pickups';
import {
  CarController,
  RemoteCar,
  applyCarWobble,
  carRadius,
  slopePitch,
  syncCarPassengers,
} from './game/car';
import { RoadObstacles } from './game/obstacles';
import { FINISH, GATE_Z, elevation, roadSurface, sampleRoad } from './game/road';
import { BOTTLE_POINTS } from './net/network';
import { HostSim } from './game/host';
import { HUD } from './game/hud';
import { ClientRoom, HostRoom } from './net/peer';
import type {
  BottleKind,
  Phase,
  RoadObstacleState,
  SceneMode,
  Vec3,
  WorldState,
} from './net/network';

// --- Renderer / scene ---------------------------------------------------

const canvas = document.getElementById('game') as HTMLCanvasElement;

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {
  const error = document.getElementById('menu-error');
  if (error) {
    error.textContent =
      'Your browser could not create a WebGL context — this game needs WebGL to run.';
  }
  throw new Error('WebGL unavailable');
}

// Software rasterizers (SwiftShader, llvmpipe…) can't afford bloom and
// shadows — drop to lo-fi automatically there. ?fx=hi / ?fx=lo overrides.
const gl = renderer.getContext();
const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
const glName = dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : '';
const fxParam = new URLSearchParams(location.search).get('fx');
const lofi =
  fxParam === 'lo' ||
  (fxParam !== 'hi' && /swiftshader|llvmpipe|software|softpipe/i.test(glName));

renderer.setPixelRatio(lofi ? 1 : Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = !lofi;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Day values; setMode() swaps to punchier night bloom
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let world = buildScene(scene, renderer, 'day');
let rain: Rain | null = null; // night-only
let steams = world.steamVents.map((vent) => new Steam(scene, vent));
const pickupFX = new PickupFX(scene);
const roadObs = new RoadObstacles(scene);
let roadAabbs: Obstacle[] = [];
const hud = new HUD();

function setMode(mode: SceneMode) {
  if (world.mode === mode) return;
  world.dispose();
  for (const steam of steams) steam.dispose();
  rain?.dispose();
  world = buildScene(scene, renderer, mode);
  steams = world.steamVents.map((vent) => new Steam(scene, vent));
  rain = mode === 'night' && !lofi ? new Rain(scene) : null;
  bloom.strength = mode === 'night' ? 0.55 : 0.3;
  bloom.threshold = mode === 'night' ? 0.62 : 0.9;
}

// --- Input ----------------------------------------------------------------

const keys = { up: false, down: false, left: false, right: false };
const KEYMAP: Record<string, keyof typeof keys> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};
window.addEventListener('keydown', (e) => {
  const key = KEYMAP[e.code];
  if (key && !(e.target instanceof HTMLInputElement)) {
    keys[key] = true;
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  const key = KEYMAP[e.code];
  if (key) keys[key] = false;
});

// Touch joystick: floats to wherever the thumb lands on the canvas.
// Drag up/down = walk, drag left/right = turn.
const stick = document.getElementById('stick')!;
const stickKnob = document.getElementById('stick-knob')!;
const JOY_RADIUS = 56;
const joy = { pointerId: null as number | null, baseX: 0, baseY: 0, fwd: 0, turn: 0 };

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || joy.pointerId !== null || !inRoom) return;
  joy.pointerId = e.pointerId;
  joy.baseX = e.clientX;
  joy.baseY = e.clientY;
  stick.style.left = `${e.clientX}px`;
  stick.style.top = `${e.clientY}px`;
  stickKnob.style.transform = 'translate(-50%, -50%)';
  stick.classList.remove('hidden');
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joy.pointerId) return;
  let dx = e.clientX - joy.baseX;
  let dy = e.clientY - joy.baseY;
  const len = Math.hypot(dx, dy);
  if (len > JOY_RADIUS) {
    dx *= JOY_RADIUS / len;
    dy *= JOY_RADIUS / len;
  }
  stickKnob.style.transform = `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`;
  joy.fwd = -dy / JOY_RADIUS;
  joy.turn = -dx / JOY_RADIUS;
});
const joyEnd = (e: PointerEvent) => {
  if (e.pointerId !== joy.pointerId) return;
  joy.pointerId = null;
  joy.fwd = 0;
  joy.turn = 0;
  stick.classList.add('hidden');
};
canvas.addEventListener('pointerup', joyEnd);
canvas.addEventListener('pointercancel', joyEnd);

if (window.matchMedia('(pointer: coarse)').matches) {
  const help = document.getElementById('help');
  if (help) help.innerHTML = 'Drag to stagger &nbsp; 🚗 button for cars &nbsp; stand at junk to clear &nbsp;·&nbsp; 🍺 +1 &nbsp; 🍷 +2 &nbsp; 🥃 +3';
}

// --- Cars: hop in / get out -------------------------------------------------

const carBtn = document.getElementById('car-btn') as HTMLButtonElement;

// Nearest car with a free seat (4 max per car)
function nearCarWithSeat(): { occupied: boolean } | null {
  if (!latestState || myCarId !== null) return null;
  let best: { occupied: boolean } | null = null;
  let bestD = 3.2 * 3.2;
  for (const c of latestState.cars) {
    if (c.occupants.length >= 4) continue;
    const dx = local.pos.x - c.p[0];
    const dz = local.pos.z - c.p[2];
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = { occupied: c.occupants.length > 0 };
    }
  }
  return best;
}

function requestCar(enter: boolean) {
  if (host) host.sim.requestCar(myId, enter);
  else clientRoom?.sendCar(enter);
}

// Nearest uncleared road obstacle within working reach (on foot only);
// radius matches the host's WORK_RADIUS (obstacles are ~4.2 half-long).
const WORK_RADIUS = 6.0;

function nearObstacle(): RoadObstacleState | null {
  if (!latestState || myCarId !== null) return null;
  let best: RoadObstacleState | null = null;
  let bestD = WORK_RADIUS * WORK_RADIUS;
  for (const ob of latestState.roadObstacles) {
    if (ob.cleared) continue;
    const dx = local.pos.x - ob.p[0];
    const dz = local.pos.z - ob.p[2];
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = ob;
    }
  }
  return best;
}

// How many on-foot players are working this obstacle (mirrors host math)
function workerCount(ob: RoadObstacleState): number {
  if (!latestState) return 0;
  let count = 0;
  for (const pl of latestState.players) {
    if (pl.car !== null) continue;
    const dx = pl.p[0] - ob.p[0];
    const dz = pl.p[2] - ob.p[2];
    if (dx * dx + dz * dz < WORK_RADIUS * WORK_RADIUS) count++;
  }
  return count;
}

// The button is cars-only; obstacle work is automatic by proximity
// (hold gestures proved unreliable on phones) and reports through the
// HUD progress panel instead.
type BtnMode = 'exit' | 'enter' | 'drive' | null;
let btnMode: BtnMode = null;

function updateCarButton() {
  let mode: BtnMode = null;
  if (latestState?.phase === 'play') {
    if (myCarId !== null) mode = 'exit';
    else {
      const near = nearCarWithSeat();
      if (near) mode = near.occupied ? 'enter' : 'drive';
    }
  }
  if (mode !== btnMode) {
    btnMode = mode;
    if (mode === null) {
      carBtn.classList.add('hidden');
    } else {
      carBtn.textContent =
        mode === 'exit' ? '🚪 Get out'
        : mode === 'enter' ? '🚗 Hop in'
        : '🚗 Drive';
      carBtn.classList.remove('hidden');
    }
  }
}

// Obstacle work state + the progress panel, refreshed every frame
function updateClearPanel() {
  const ob = latestState?.phase === 'play' ? nearObstacle() : null;
  working = ob !== null;
  hud.setClearPanel(ob ? ob.progress : null, ob ? workerCount(ob) : 0);
}

// Raw pointer events (no click) so the browser's long-press
// text-selection / context menu never interferes on phones.
let btnPressed = false;
carBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  btnPressed = true;
});
carBtn.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (!btnPressed) return;
  btnPressed = false;
  if (btnMode === 'exit') requestCar(false);
  else if (btnMode === 'enter' || btnMode === 'drive') requestCar(true);
});
carBtn.addEventListener('pointercancel', () => {
  btnPressed = false;
});
carBtn.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && !e.repeat && !(e.target instanceof HTMLInputElement)) {
    if (myCarId !== null) requestCar(false);
    else if (nearCarWithSeat()) requestCar(true);
  }
});

// --- Session state ----------------------------------------------------------

const SEND_INTERVAL_MS = 66; // ~15 Hz

let myId = '';
let host: { room: HostRoom; sim: HostSim } | null = null;
let clientRoom: ClientRoom | null = null;
let latestState: WorldState | null = null;
let lastPhase: Phase = 'lobby';
let inRoom = false;

const local = new LocalController();
const carCtrl = new CarController();
let myCarId: number | null = null;
let amDriver = false;
let working = false; // auto-set while standing at an uncleared obstacle
let myMesh: THREE.Group | null = null;

const remotes = new Map<string, RemoteAvatar>();
const bottles = new Map<number, { mesh: THREE.Group; kind: BottleKind }>();
const cars = new Map<number, RemoteCar>();

function enterRoom(colorIndex: number, name: string, code: string, isHost: boolean) {
  myMesh = createPlayerMesh(colorIndex, name);
  scene.add(myMesh);
  inRoom = true;
  hud.showLobby(code, isHost);
}

async function createRoom(name: string, mode: SceneMode) {
  const room = await HostRoom.create();
  const sim = new HostSim(() => randomFreePos(world), room.myId, name, mode);
  room.onJoin = (id, joinName) => {
    const colorIndex = sim.addPlayer(id, joinName);
    if (colorIndex !== null) hud.updateLobby(sim.state.players);
    return colorIndex;
  };
  room.onLeave = (id) => {
    sim.removePlayer(id);
    hud.updateLobby(sim.state.players);
  };
  room.onPos = (id, p, ry, moving, isWorking) => sim.setPos(id, p, ry, moving, isWorking);
  room.onCar = (id, enter) => sim.requestCar(id, enter);
  host = { room, sim };
  myId = room.myId;
  latestState = sim.state;
  setInterval(() => room.broadcast(sim.state), SEND_INTERVAL_MS);
  enterRoom(0, name, room.code, true);
}

async function joinRoom(code: string, name: string) {
  const room = await ClientRoom.join(code, name);
  clientRoom = room;
  myId = room.myId;
  room.onState = (state) => {
    latestState = state;
  };
  room.onClosed = (reason) => {
    // No alert(): it blocks the page (and JS timers) until dismissed
    const notice = document.createElement('div');
    notice.className = 'panel';
    notice.innerHTML = `<h2>🍻 ${reason}</h2><p class="tag">Heading back to the menu…</p>`;
    document.getElementById('ui')!.append(notice);
    setTimeout(() => location.reload(), 2500);
  };
  setInterval(() => {
    const pose = currentPose();
    room.sendPos(pose.p, pose.ry, pose.moving, pose.working);
  }, SEND_INTERVAL_MS);
  enterRoom(room.colorIndex, name, code, false);
}

function currentPose(): { p: Vec3; ry: number; moving: boolean; working: boolean } {
  if (myCarId !== null && amDriver) {
    return {
      p: [carCtrl.pos.x, 0, carCtrl.pos.z],
      ry: carCtrl.ry,
      moving: Math.abs(carCtrl.speed) > 0.3,
      working: false,
    };
  }
  // Passengers' reports are ignored by the host (pinned to the car)
  return {
    p: [local.pos.x, 0, local.pos.z],
    ry: local.ry,
    moving: local.moving,
    working,
  };
}

hud.onCreate = async (name, mode) => {
  hud.setBusy(true, 'Opening the alley…');
  try {
    await createRoom(name, mode);
  } catch {
    hud.setBusy(false);
    hud.menuError('Could not create a room — check your connection and retry');
  }
};

hud.onJoin = async (code, name) => {
  if (code.length !== 4) {
    hud.menuError('Enter the 4-letter room code');
    return;
  }
  hud.setBusy(true, 'Stumbling in…');
  try {
    await joinRoom(code, name);
  } catch (err) {
    hud.setBusy(false);
    hud.menuError(err instanceof Error ? err.message : 'Could not join');
  }
};

hud.onStart = () => host?.sim.startRound();
hud.onAgain = () => host?.sim.startRound();

// --- World state → scene -----------------------------------------------------

function applyState(state: WorldState, t: number) {
  setMode(state.mode);
  if (state.phase !== lastPhase) {
    onPhaseChange(state);
    lastPhase = state.phase;
  }

  // My car enter/exit/seat transitions (host decides; we react).
  // Becoming occupants[0] — even mid-ride, when the driver bails —
  // hands us the wheel.
  const me = state.players.find((p) => p.id === myId);
  const myCar = me?.car ?? null;
  const myCarState = myCar !== null ? state.cars.find((c) => c.id === myCar) : undefined;
  const nowDriver = !!myCarState && myCarState.occupants[0] === myId;
  if (myCar !== myCarId || nowDriver !== amDriver) {
    if (nowDriver && myCarState) {
      carCtrl.reset(myCarState.p, myCarState.ry, myCarState.kind);
    } else if (myCar === null && me) {
      // Host placed us beside the car on exit
      local.pos.set(me.p[0], 0, me.p[2]);
      local.ry = me.ry;
    }
    myCarId = myCar;
    amDriver = nowDriver;
  }

  const seenPlayers = new Set<string>();
  for (const p of state.players) {
    seenPlayers.add(p.id);
    if (p.id === myId) continue;
    let avatar = remotes.get(p.id);
    if (!avatar) {
      avatar = new RemoteAvatar(p.colorIndex, p.name);
      scene.add(avatar.group);
      remotes.set(p.id, avatar);
    }
    avatar.setTarget(p.p, p.ry, p.moving);
    avatar.group.visible = p.car === null; // hidden while driving
  }
  for (const [id, avatar] of remotes) {
    if (!seenPlayers.has(id)) {
      scene.remove(avatar.group);
      remotes.delete(id);
    }
  }

  const seenBottles = new Set<number>();
  for (const b of state.bottles) {
    seenBottles.add(b.id);
    let entry = bottles.get(b.id);
    if (!entry || entry.kind !== b.kind) {
      if (entry) scene.remove(entry.mesh);
      entry = { mesh: createBottleMesh(b.kind), kind: b.kind };
      scene.add(entry.mesh);
      bottles.set(b.id, entry);
    }
    const groundY = elevation(b.p[0], b.p[2]);
    if (entry.mesh.visible && !b.active && state.phase === 'play') {
      pickupFX.spawn([b.p[0], groundY, b.p[2]], BOTTLE_POINTS[b.kind], BOTTLE_GLOW[b.kind]);
    }
    entry.mesh.visible = b.active;
    entry.mesh.position.set(b.p[0], groundY + 0.2 + Math.sin(t * 2 + b.id) * 0.08, b.p[2]);
    entry.mesh.rotation.y = t * 0.9 + b.id;
  }
  for (const [id, entry] of bottles) {
    if (!seenBottles.has(id)) {
      scene.remove(entry.mesh);
      bottles.delete(id);
    }
  }

  roadObs.sync(state.roadObstacles);
  roadAabbs = roadObs.aabbs(state.roadObstacles);

  const seenCars = new Set<number>();
  for (const c of state.cars) {
    seenCars.add(c.id);
    let car = cars.get(c.id);
    if (!car) {
      car = new RemoteCar(c.kind);
      car.snap(c.p, c.ry);
      scene.add(car.group);
      cars.set(c.id, car);
    }
    // The car I drive is posed from the local controller in the main loop
    if (!(c.id === myCarId && amDriver)) car.setTarget(c.p, c.ry);
    // Window/bed passengers (driver stays invisible inside)
    syncCarPassengers(car.group, c.occupants, state.players);
  }
  for (const [id, car] of cars) {
    if (!seenCars.has(id)) {
      scene.remove(car.group);
      cars.delete(id);
    }
  }

  if (state.phase === 'lobby') {
    hud.updateLobby(state.players);
  } else {
    hud.setScores(state.players, myId);
  }
}

function onPhaseChange(state: WorldState) {
  if (state.phase === 'play') {
    const me = state.players.find((p) => p.id === myId);
    if (me) {
      local.pos.set(me.p[0], 0, me.p[2]);
      local.ry = me.ry;
    }
    hud.showPlaying();
  } else if (state.phase === 'won') {
    hud.showWon(state.players);
  }
}

// --- Camera ------------------------------------------------------------------

const camTarget = new THREE.Vector3();

function updateCamera(dt: number, t: number) {
  const inCar = myCarId !== null;
  // Driver follows the local sim; a passenger follows the car mesh
  const carMesh = inCar && !amDriver ? cars.get(myCarId!)?.group : null;
  const px = inCar ? (carMesh ? carMesh.position.x : carCtrl.pos.x) : local.pos.x;
  const pz = inCar ? (carMesh ? carMesh.position.z : carCtrl.pos.z) : local.pos.z;
  const ry = inCar ? (carMesh ? carMesh.rotation.y : carCtrl.ry) : local.ry;
  const dist = inCar ? 10 : 6.2;
  const groundY = elevation(px, pz);
  camTarget.set(px - Math.sin(ry) * dist, 0, pz - Math.cos(ry) * dist);
  // Keep the chase camera out of buildings (same pushout as bodies)
  collideCircle(camTarget, 1.2, world);
  // Ride the terrain: camera height follows the ground under it
  camTarget.y = Math.max(elevation(camTarget.x, camTarget.z), groundY) + (inCar ? 6.4 : 4.4);
  camera.position.lerp(camTarget, 1 - Math.pow(0.0005, dt));
  // Subtle drunk camera roll
  camera.up.set(Math.sin(t * 0.9) * 0.05, 1, 0).normalize();
  camera.lookAt(px, groundY + 1.6, pz);
}

// --- Main loop -----------------------------------------------------------------

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  world.updateFlicker(t);
  rain?.update(dt);
  for (const steam of steams) steam.update(dt);
  pickupFX.update(dt);
  roadObs.update(dt);

  if (inRoom && myMesh) {
    if (latestState) applyState(latestState, t);
    let fwd = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    let turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    if (joy.pointerId !== null) {
      fwd = joy.fwd;
      turn = joy.turn;
    }
    // Other cars are round blockers; uncleared road junk blocks too
    const circles: Circle[] = [];
    if (latestState) {
      for (const c of latestState.cars) {
        if (c.id === myCarId) continue;
        circles.push({ x: c.p[0], z: c.p[2], r: carRadius(c.kind) });
      }
    }
    if (myCarId !== null && amDriver) {
      const surface = roadSurface(carCtrl.pos.x, carCtrl.pos.z);
      carCtrl.update(dt, fwd, turn, world, circles, roadAabbs, surface);
      myMesh.visible = false;
      const mine = cars.get(myCarId);
      if (mine) {
        mine.group.position.set(
          carCtrl.pos.x,
          elevation(carCtrl.pos.x, carCtrl.pos.z),
          carCtrl.pos.z,
        );
        mine.group.rotation.y = carCtrl.ry;
        mine.group.rotation.x = slopePitch(carCtrl.pos.x, carCtrl.pos.z, carCtrl.ry);
        applyCarWobble(mine.group, t, dt, carCtrl.speed);
      }
    } else if (myCarId !== null) {
      // Passenger: the car is driven elsewhere; we just hang out the window
      myMesh.visible = false;
    } else {
      local.update(dt, fwd, turn, world, circles, roadAabbs);
      myMesh.visible = true;
      myMesh.position.set(local.pos.x, elevation(local.pos.x, local.pos.z), local.pos.z);
      myMesh.rotation.y = local.ry;
      applyWobble(myMesh, t, local.moving);
    }
    if (host) {
      const pose = currentPose();
      host.sim.setPos(myId, pose.p, pose.ry, pose.moving, pose.working);
      host.sim.tick(dt);
    }
    updateCarButton();
    updateClearPanel();
    updateCamera(dt, t);
    // Shadows follow whoever we are; the world is too long for one map
    const pose = currentPose();
    world.focusShadow(pose.p[0], pose.p[2]);
    // Distance readout once out of town
    if (latestState?.phase === 'play' && pose.p[2] > GATE_Z - 20) {
      hud.setRouteLabel(`ROUTE 65 — ${Math.max(0, Math.round(FINISH.p[2] - pose.p[2]))} m`);
    } else {
      hud.setRouteLabel(null);
    }
  } else {
    // Menu backdrop: slow drift through the alley
    camera.position.set(Math.sin(t * 0.08) * 5, 5.5, Math.cos(t * 0.11) * 10);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 1.2, 0);
  }

  for (const avatar of remotes.values()) {
    avatar.update(dt, t);
  }
  for (const [id, car] of cars) {
    if (!(id === myCarId && amDriver)) car.update(dt, t);
  }

  if (lofi) renderer.render(scene, camera);
  else composer.render();
});

// Read-only debug handle for end-to-end tests
(window as unknown as Record<string, unknown>).__dad = {
  get pos(): [number, number] {
    if (myCarId !== null && amDriver) return [carCtrl.pos.x, carCtrl.pos.z];
    if (myCarId !== null) {
      const mesh = cars.get(myCarId)?.group;
      if (mesh) return [mesh.position.x, mesh.position.z];
    }
    return [local.pos.x, local.pos.z];
  },
  get ry(): number {
    return myCarId !== null && amDriver ? carCtrl.ry : local.ry;
  },
  get car(): number | null {
    return myCarId;
  },
  get driver(): boolean {
    return amDriver;
  },
  get speed(): number {
    return carCtrl.speed;
  },
  get bottles(): [number, number][] {
    return (latestState?.bottles ?? [])
      .filter((b) => b.active)
      .map((b) => [b.p[0], b.p[2]]);
  },
  get cars(): { id: number; kind: string; seats: number }[] {
    return (latestState?.cars ?? []).map((c) => ({
      id: c.id,
      kind: c.kind,
      seats: c.occupants.length,
    }));
  },
  get surface(): string {
    const pose = currentPose();
    return roadSurface(pose.p[0], pose.p[2]);
  },
  get alt(): number {
    const pose = currentPose();
    return elevation(pose.p[0], pose.p[2]);
  },
  get phase(): string {
    return latestState?.phase ?? 'lobby';
  },
  get working(): boolean {
    return working;
  },
  get obstacles(): {
    id: number;
    kind: string;
    progress: number;
    cleared: boolean;
    pos: [number, number];
  }[] {
    return (latestState?.roadObstacles ?? []).map((ob) => ({
      id: ob.id,
      kind: ob.kind,
      progress: ob.progress,
      cleared: ob.cleared,
      pos: [ob.p[0], ob.p[2]],
    }));
  },
  // Road centerline sample for tests (t in 0..1)
  roadPoint(t: number): [number, number] {
    const sample = sampleRoad(Math.min(1, Math.max(0, t)));
    return [sample.p[0], sample.p[2]];
  },
  // Test-only teleport, active with ?dev=1 (no-op otherwise); also
  // moves the car when driving, so tests can reach the finish.
  teleport(x: number, z: number, ry?: number) {
    if (!new URLSearchParams(location.search).has('dev')) return;
    if (myCarId !== null && amDriver) {
      carCtrl.pos.set(x, 0, z);
      if (ry !== undefined) carCtrl.ry = ry;
    } else if (myCarId === null) {
      local.pos.set(x, 0, z);
      if (ry !== undefined) local.ry = ry;
    }
  },
};
