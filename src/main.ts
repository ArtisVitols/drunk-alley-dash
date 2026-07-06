import './style.css';
import * as THREE from 'three';
import { buildScene, randomFreePos } from './game/scene';
import {
  LocalController,
  RemoteAvatar,
  applyWobble,
  createPlayerMesh,
  type InputState,
} from './game/player';
import { createBottleMesh } from './game/pickups';
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 120);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const world = buildScene(scene);
const hud = new HUD();

// --- Input ----------------------------------------------------------------

const input: InputState = { up: false, down: false, left: false, right: false };
const KEYMAP: Record<string, keyof InputState> = {
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
    input[key] = true;
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  const key = KEYMAP[e.code];
  if (key) input[key] = false;
});

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
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  world.updateFlicker(t);

  if (inRoom && myMesh) {
    if (latestState) applyState(latestState, t);
    local.update(dt, input, world);
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

  renderer.render(scene, camera);
});
