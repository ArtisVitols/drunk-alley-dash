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
  createPlayerMesh,
} from './game/player';
import { BOTTLE_GLOW, createBottleMesh } from './game/pickups';
import { BOTTLE_POINTS } from './net/network';
import { HostSim } from './game/host';
import { HUD } from './game/hud';
import { ClientRoom, HostRoom } from './net/peer';
import type { BottleKind, Phase, Vec3, WorldState } from './net/network';

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 120);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.62);
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

const world = buildScene(scene, renderer);
const rain = new Rain(scene);
const steams = world.steamVents.map((vent) => new Steam(scene, vent));
const pickupFX = new PickupFX(scene);
const hud = new HUD();

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
  if (help) help.innerHTML = 'Drag anywhere to stagger around &nbsp;·&nbsp; 🍺 +1 &nbsp; 🍷 +2 &nbsp; 🥃 +3';
}

// --- Session state ----------------------------------------------------------

const SEND_INTERVAL_MS = 66; // ~15 Hz

let myId = '';
let host: { room: HostRoom; sim: HostSim } | null = null;
let latestState: WorldState | null = null;
let lastPhase: Phase = 'lobby';
let inRoom = false;

const local = new LocalController();
let myMesh: THREE.Group | null = null;

const remotes = new Map<string, RemoteAvatar>();
const bottles = new Map<number, { mesh: THREE.Group; kind: BottleKind }>();

function enterRoom(colorIndex: number, name: string, code: string, isHost: boolean) {
  myMesh = createPlayerMesh(colorIndex, name);
  scene.add(myMesh);
  inRoom = true;
  hud.showLobby(code, isHost);
}

async function createRoom(name: string) {
  const room = await HostRoom.create();
  const sim = new HostSim(() => randomFreePos(world), room.myId, name);
  room.onJoin = (id, joinName) => {
    const colorIndex = sim.addPlayer(id, joinName);
    if (colorIndex !== null) hud.updateLobby(sim.state.players);
    return colorIndex;
  };
  room.onLeave = (id) => {
    sim.removePlayer(id);
    hud.updateLobby(sim.state.players);
  };
  room.onPos = (id, p, ry, moving) => sim.setPos(id, p, ry, moving);
  host = { room, sim };
  myId = room.myId;
  latestState = sim.state;
  setInterval(() => room.broadcast(sim.state), SEND_INTERVAL_MS);
  enterRoom(0, name, room.code, true);
}

async function joinRoom(code: string, name: string) {
  const room = await ClientRoom.join(code, name);
  myId = room.myId;
  room.onState = (state) => {
    latestState = state;
  };
  room.onClosed = (reason) => {
    alert(reason);
    location.reload();
  };
  setInterval(() => {
    room.sendPos([local.pos.x, 0, local.pos.z], local.ry, local.moving);
  }, SEND_INTERVAL_MS);
  enterRoom(room.colorIndex, name, code, false);
}

hud.onCreate = async (name) => {
  hud.setBusy(true, 'Opening the alley…');
  try {
    await createRoom(name);
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
  if (state.phase !== lastPhase) {
    onPhaseChange(state);
    lastPhase = state.phase;
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
    if (entry.mesh.visible && !b.active && state.phase === 'play') {
      pickupFX.spawn(b.p, BOTTLE_POINTS[b.kind], BOTTLE_GLOW[b.kind]);
    }
    entry.mesh.visible = b.active;
    entry.mesh.position.set(b.p[0], 0.2 + Math.sin(t * 2 + b.id) * 0.08, b.p[2]);
    entry.mesh.rotation.y = t * 0.9 + b.id;
  }
  for (const [id, entry] of bottles) {
    if (!seenBottles.has(id)) {
      scene.remove(entry.mesh);
      bottles.delete(id);
    }
  }

  if (state.phase === 'lobby') {
    hud.updateLobby(state.players);
  } else if (state.phase === 'play') {
    hud.setTimer(state.timeLeft);
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
  } else if (state.phase === 'end') {
    hud.showEnd(state.players, myId);
  }
}

// --- Camera ------------------------------------------------------------------

const camTarget = new THREE.Vector3();

function updateCamera(dt: number, t: number) {
  camTarget.set(
    local.pos.x - Math.sin(local.ry) * 6.2,
    4.4,
    local.pos.z - Math.cos(local.ry) * 6.2,
  );
  camTarget.x = Math.min(7.4, Math.max(-7.4, camTarget.x));
  camTarget.z = Math.min(29.4, Math.max(-29.4, camTarget.z));
  camera.position.lerp(camTarget, 1 - Math.pow(0.0005, dt));
  // Subtle drunk camera roll
  camera.up.set(Math.sin(t * 0.9) * 0.05, 1, 0).normalize();
  camera.lookAt(local.pos.x, 1.6, local.pos.z);
}

// --- Main loop -----------------------------------------------------------------

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  world.updateFlicker(t);
  rain.update(dt);
  for (const steam of steams) steam.update(dt);
  pickupFX.update(dt);

  if (inRoom && myMesh) {
    if (latestState) applyState(latestState, t);
    let fwd = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    let turn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    if (joy.pointerId !== null) {
      fwd = joy.fwd;
      turn = joy.turn;
    }
    local.update(dt, fwd, turn, world);
    myMesh.position.copy(local.pos);
    myMesh.rotation.y = local.ry;
    applyWobble(myMesh, t, local.moving);
    if (host) {
      host.sim.setPos(myId, [local.pos.x, 0, local.pos.z] as Vec3, local.ry, local.moving);
      host.sim.tick(dt);
    }
    updateCamera(dt, t);
  } else {
    // Menu backdrop: slow drift through the alley
    camera.position.set(Math.sin(t * 0.08) * 5, 5.5, Math.cos(t * 0.11) * 10);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 1.2, 0);
  }

  for (const avatar of remotes.values()) {
    avatar.update(dt, t);
  }

  composer.render();
});
