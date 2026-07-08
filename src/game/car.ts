import * as THREE from 'three';
import type { CarKind, PlayerState, Vec3 } from '../net/network';
import type { Obstacle, WorldGeom } from './scene';
import type { Circle } from './player';
import { PLAYER_COLORS, collideCircle, collideCircles } from './player';
import { elevation } from './road';

// Terrain slope along a heading — used to pitch car meshes on hills
export function slopePitch(x: number, z: number, ry: number): number {
  const dx = Math.sin(ry);
  const dz = Math.cos(ry);
  const ahead = elevation(x + dx * 2, z + dz * 2);
  const behind = elevation(x - dx * 2, z - dz * 2);
  return -Math.atan2(ahead - behind, 4);
}

// Per-kind handling: the sedan is nimble, the RV is a drunk whale.
const CAR_STATS: Record<
  CarKind,
  { max: number; reverse: number; accel: number; turn: number; radius: number; sway: number }
> = {
  sedan: { max: 16, reverse: 6, accel: 15, turn: 2.3, radius: 1.1, sway: 0.5 },
  van: { max: 13.5, reverse: 5.5, accel: 11, turn: 2.0, radius: 1.3, sway: 0.65 },
  rv: { max: 11.5, reverse: 4.5, accel: 8.5, turn: 1.7, radius: 1.85, sway: 0.95 },
  truck: { max: 13, reverse: 5.5, accel: 10, turn: 1.9, radius: 1.4, sway: 0.6 },
};

const DRAG = 0.55;

export const carRadius = (kind: CarKind) => CAR_STATS[kind].radius;

export type Surface = 'city' | 'asphalt' | 'sand' | 'grass';

interface Slot {
  anchor: THREE.Group;
  mode: 'lean' | 'stand';
  side: 1 | -1;
  playerId: string | null;
}

interface CarRig {
  body: THREE.Group;
  wheels: THREE.Mesh[];
  slots: Slot[];
}

const std = (color: number, roughness = 0.5, metalness = 0.4) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const GLASS = () => std(0x1c2126, 0.15, 0.7);

function addWheels(
  body: THREE.Group,
  wheels: THREE.Mesh[],
  radius: number,
  positions: [number, number][],
) {
  const geo = new THREE.CylinderGeometry(radius, radius, 0.24, 12);
  const mat = std(0x15161a, 0.8, 0.2);
  for (const [x, z] of positions) {
    const wheel = new THREE.Mesh(geo, mat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, radius, z);
    body.add(wheel);
    wheels.push(wheel);
  }
}

function addLights(body: THREE.Group, halfW: number, y: number, front: number, rear: number) {
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xffedb0,
    emissiveIntensity: 1.6,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x7a1212,
    emissive: 0xd92222,
    emissiveIntensity: 1.1,
  });
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.06), headMat);
    head.position.set(halfW * 0.66 * side, y, front);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.06), tailMat);
    tail.position.set(halfW * 0.66 * side, y, rear);
    body.add(head, tail);
  }
}

// Four very different rides. All face +Z.
function buildBody(kind: CarKind, body: THREE.Group, wheels: THREE.Mesh[]) {
  if (kind === 'sedan') {
    const paint = std(0xd9534f, 0.35, 0.55);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 3.1), paint);
    hull.position.y = 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.52, 1.5), GLASS());
    cabin.position.set(0, 1.06, -0.15);
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.16, 0.14), std(0x9aa0a8, 0.3, 0.8));
    bumperF.position.set(0, 0.38, 1.58);
    const bumperR = bumperF.clone();
    bumperR.position.z = -1.58;
    body.add(hull, cabin, bumperF, bumperR);
    addWheels(body, wheels, 0.3, [[-0.72, 1.0], [0.72, 1.0], [-0.72, -1.0], [0.72, -1.0]]);
    addLights(body, 0.75, 0.62, 1.56, -1.56);
  } else if (kind === 'van') {
    const paint = std(0x4f7bd9, 0.4, 0.5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 3.5), paint);
    box.position.y = 1.05;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.5), paint);
    nose.position.set(0, 0.6, 1.85);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 0.06), GLASS());
    windshield.position.set(0, 1.35, 1.73);
    windshield.rotation.x = -0.25;
    const windowBand = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.42, 2.6), GLASS());
    windowBand.position.set(0, 1.42, -0.2);
    body.add(box, nose, windshield, windowBand);
    addWheels(body, wheels, 0.32, [[-0.8, 1.25], [0.8, 1.25], [-0.8, -1.15], [0.8, -1.15]]);
    addLights(body, 0.85, 0.55, 2.1, -1.76);
  } else if (kind === 'rv') {
    // The team ride: a proper beat-up motorhome, bigger than the rest
    const cream = std(0xe8e4d8, 0.55, 0.2);
    const accent = std(0xd07a2e, 0.5, 0.3);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.3, 6.2), cream);
    box.position.y = 1.6;
    // Cab-over bunk jutting forward above the windshield
    const bunk = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.85, 1.2), cream);
    bunk.position.set(0, 2.32, 3.35);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.3, 6.22), accent);
    stripe.position.y = 1.05;
    const stripe2 = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.12, 6.22), std(0x8a4a1a, 0.5, 0.3));
    stripe2.position.y = 1.32;
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.85, 0.06), GLASS());
    windshield.position.set(0, 1.95, 3.08);
    const windowBand = new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.55, 3.6), GLASS());
    windowBand.position.set(0, 2.05, -0.7);
    const roofBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 1.6), std(0xcfc8b8, 0.6, 0.2));
    roofBox.position.set(0, 2.9, 0.8);
    // Rooftop solar panel + vent
    const solar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 2.0), std(0x1c2b4a, 0.25, 0.7));
    solar.position.set(0, 2.79, -1.6);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), std(0xb8b0a0, 0.6, 0.2));
    vent.position.set(0.6, 2.84, 2.6);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.75), std(0xb8b0a0, 0.6, 0.2));
    door.position.set(1.16, 1.15, -2.2);
    // Rear ladder
    const ladder = new THREE.Group();
    const railGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6);
    const railMat = std(0x9aa0a8, 0.35, 0.8);
    for (const lx of [-0.22, 0.22]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(0.7 + lx, 1.7, -3.13);
      ladder.add(rail);
    }
    for (let i = 0; i < 5; i++) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.44, 6), railMat);
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0.7, 0.85 + i * 0.42, -3.13);
      ladder.add(rung);
    }
    // Spare wheel on the back
    const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.24, 12), std(0x15161a, 0.8, 0.2));
    spare.rotation.x = Math.PI / 2;
    spare.position.set(-0.55, 1.25, -3.22);
    // Awning roll along the door side
    const awning = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), accent);
    awning.rotation.x = Math.PI / 2;
    awning.position.set(1.2, 2.5, -0.8);
    body.add(
      box, bunk, stripe, stripe2, windshield, windowBand, roofBox,
      solar, vent, door, ladder, spare, awning,
    );
    addWheels(body, wheels, 0.38, [[-1.05, 2.2], [1.05, 2.2], [-1.05, -2.0], [1.05, -2.0]]);
    addLights(body, 1.15, 0.65, 3.12, -3.12);
  } else {
    // truck — cab up front, open cargo bed in the back
    const paint = std(0xd9b44f, 0.4, 0.5);
    const bedMat = std(0x5a5e64, 0.7, 0.5);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 4.4), std(0x2a2d33, 0.7, 0.5));
    chassis.position.y = 0.5;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.5), paint);
    cab.position.set(0, 1.2, 1.35);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.5, 0.06), GLASS());
    windshield.position.set(0, 1.42, 2.08);
    const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.08, 2.5), bedMat);
    bedFloor.position.set(0, 0.72, -0.95);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 2.5), bedMat);
    wallL.position.set(-0.81, 0.98, -0.95);
    const wallR = wallL.clone();
    wallR.position.x = 0.81;
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.5, 0.08), bedMat);
    wallB.position.set(0, 0.98, -2.16);
    body.add(chassis, cab, windshield, bedFloor, wallL, wallR, wallB);
    addWheels(body, wheels, 0.34, [[-0.82, 1.45], [0.82, 1.45], [-0.82, -1.45], [0.82, -1.45]]);
    addLights(body, 0.85, 0.7, 2.12, -2.2);
  }
}

// Passenger window/bed anchor points (car-local; slot 0..2 for
// occupants 1..3 — the driver is inside, invisible, steering).
const SLOT_SPECS: Record<CarKind, { x: number; y: number; z: number; mode: 'lean' | 'stand' }[]> = {
  sedan: [
    { x: 0.78, y: 1.0, z: 0.45, mode: 'lean' },
    { x: -0.78, y: 1.0, z: -0.55, mode: 'lean' },
    { x: 0.78, y: 1.0, z: -0.55, mode: 'lean' },
  ],
  van: [
    { x: 0.9, y: 1.35, z: 0.9, mode: 'lean' },
    { x: -0.9, y: 1.35, z: -0.2, mode: 'lean' },
    { x: 0.9, y: 1.35, z: -1.1, mode: 'lean' },
  ],
  rv: [
    { x: 1.2, y: 1.95, z: 1.6, mode: 'lean' },
    { x: -1.2, y: 1.95, z: 0.1, mode: 'lean' },
    { x: 1.2, y: 1.95, z: -1.6, mode: 'lean' },
  ],
  truck: [
    { x: 0.88, y: 1.15, z: 1.3, mode: 'lean' },
    { x: -0.42, y: 0.76, z: -0.6, mode: 'stand' },
    { x: 0.42, y: 0.76, z: -1.5, mode: 'stand' },
  ],
};

export function createCarMesh(kind: CarKind): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  buildBody(kind, body, wheels);

  const slots: Slot[] = SLOT_SPECS[kind].map((spec) => {
    const anchor = new THREE.Group();
    anchor.position.set(spec.x, spec.y, spec.z);
    body.add(anchor);
    return { anchor, mode: spec.mode, side: (spec.x >= 0 ? 1 : -1) as 1 | -1, playerId: null };
  });

  group.add(body);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  group.userData.carRig = { body, wheels, slots } satisfies CarRig;
  return group;
}

// Upper-body drunk guy hanging out of a window (lean) or standing in
// the truck bed (stand), waving his bottle around.
function createPassengerMesh(colorIndex: number, mode: 'lean' | 'stand', side: 1 | -1): THREE.Group {
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  const jacket = std(color, 0.8, 0);
  const skin = std(0xe8a97e, 0.8, 0);
  const dark = std(0x141414, 0.6, 0);
  const group = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.26, 4, 8), jacket);
  torso.position.y = 0.18;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
  head.position.y = 0.56;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0xd94a4a, 0.55, 0));
  nose.position.set(0, 0.53, 0.18);
  for (const es of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), std(0xf2f0e8, 0.5, 0));
    eye.position.set(0.075 * es, 0.59, 0.15);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.016, 5, 5), dark);
    pupil.position.set(0.075 * es, 0.585, 0.185);
    group.add(eye, pupil);
  }
  const beanie = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
    std(new THREE.Color(color).multiplyScalar(0.45).getHex(), 0.9, 0),
  );
  beanie.position.y = 0.6;
  group.add(torso, head, nose, beanie);

  const makeWaveArm = (ax: number, baseZ: number) => {
    const arm = new THREE.Group();
    arm.position.set(ax, 0.38, 0);
    arm.rotation.z = baseZ;
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 3, 8), jacket);
    limb.position.y = 0.2;
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8),
      std(0x7a4210, 0.3, 0.1),
    );
    bottle.position.y = 0.44;
    arm.add(limb, bottle);
    arm.userData.waveBase = baseZ;
    arm.name = 'wave';
    group.add(arm);
    return arm;
  };

  if (mode === 'lean') {
    // Hanging out of the window: tilted outward, one arm flailing
    makeWaveArm(0.24 * side, -0.9 * side);
    group.rotation.z = -0.62 * side;
    group.rotation.y = 0.25 * side;
    group.position.x = 0.12 * side;
  } else {
    // Standing in the truck bed: both arms up, party mode
    makeWaveArm(0.24, -0.7);
    makeWaveArm(-0.24, 0.7);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  group.userData.phase = Math.random() * Math.PI * 2;
  return group;
}

// Fill/empty window slots to match the occupant list (minus the driver).
export function syncCarPassengers(
  carGroup: THREE.Group,
  occupants: string[],
  players: PlayerState[],
) {
  const rig = carGroup.userData.carRig as CarRig | undefined;
  if (!rig) return;
  const passengers = occupants.slice(1);
  rig.slots.forEach((slot, i) => {
    const wanted = passengers[i] ?? null;
    if (slot.playerId === wanted) return;
    slot.anchor.clear();
    slot.playerId = wanted;
    if (wanted) {
      const player = players.find((p) => p.id === wanted);
      slot.anchor.add(createPassengerMesh(player?.colorIndex ?? 0, slot.mode, slot.side));
    }
  });
}

// Suspension sway, spinning wheels, and flailing passengers.
export function applyCarWobble(mesh: THREE.Group, t: number, dt: number, speed: number) {
  const rig = mesh.userData.carRig as CarRig | undefined;
  if (!rig) return;
  const k = Math.min(1, Math.abs(speed) / 14);
  rig.body.rotation.z = Math.sin(t * 3.1) * 0.05 * k;
  rig.body.rotation.x = Math.sin(t * 2.3) * 0.025 * k - speed * 0.0016;
  for (const wheel of rig.wheels) wheel.rotation.x += (speed * dt) / 0.3;
  for (const slot of rig.slots) {
    const passenger = slot.anchor.children[0];
    if (!passenger) continue;
    const phase = passenger.userData.phase as number;
    passenger.position.y = Math.sin(t * 5.2 + phase) * 0.04 * (0.4 + k);
    for (const child of passenger.children) {
      if (child.name === 'wave') {
        child.rotation.z =
          (child.userData.waveBase as number) + Math.sin(t * 6 + phase) * (0.35 + 0.35 * k);
      }
    }
  }
}

export class CarController {
  pos = new THREE.Vector3();
  ry = 0;
  speed = 0;
  crashIntensity = 0; // set on a hard hit; consumer resets after use
  private stats = CAR_STATS.sedan;
  private swayClock = Math.random() * 10;

  reset(p: Vec3, ry: number, kind: CarKind) {
    this.pos.set(p[0], 0, p[2]);
    this.ry = ry;
    this.speed = 0;
    this.stats = CAR_STATS[kind];
  }

  update(
    dt: number,
    throttle: number,
    steer: number,
    world: WorldGeom,
    circles: Circle[] = [],
    extraObstacles?: Obstacle[],
    surface: Surface = 'city',
  ) {
    const s = this.stats;
    // Grass bogs the car down; keep to the road
    const maxSpeed = surface === 'grass' ? s.max * 0.35 : s.max;
    this.speed += throttle * s.accel * dt;
    this.speed -= this.speed * DRAG * dt;
    this.speed = Math.min(maxSpeed, Math.max(-s.reverse, this.speed));
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;

    const grip = Math.min(1, Math.abs(this.speed) / 7);
    // Steering only bites when rolling; reversing flips it like a real car
    this.ry += steer * s.turn * grip * Math.sign(this.speed || 1) * dt;
    // Drunk at the wheel: the car pulls side to side on its own —
    // worse on loose sand
    this.swayClock += dt;
    const sway = s.sway * (surface === 'sand' ? 1.35 : 1);
    this.ry += Math.sin(this.swayClock * 1.4) * sway * grip * dt;

    this.pos.x += Math.sin(this.ry) * this.speed * dt;
    this.pos.z += Math.cos(this.ry) * this.speed * dt;
    const hitWorld = collideCircle(this.pos, s.radius, world, extraObstacles);
    const hitCars = collideCircles(this.pos, s.radius, circles);
    if (hitWorld || hitCars) {
      if (Math.abs(this.speed) > 2.5) this.crashIntensity = Math.abs(this.speed);
      this.speed *= Math.pow(0.02, dt); // crunch — bleed speed fast
    }
  }
}

// Interpolates other players' cars between network updates.
export class RemoteCar {
  readonly group: THREE.Group;
  private targetPos = new THREE.Vector3();
  private targetRy = 0;
  private lastPos = new THREE.Vector3();
  private speed = 0;

  constructor(kind: CarKind) {
    this.group = createCarMesh(kind);
  }

  get currentSpeed(): number {
    return this.speed;
  }

  setTarget(p: Vec3, ry: number) {
    // y is derived from terrain, never from the network
    this.targetPos.set(p[0], elevation(p[0], p[2]), p[2]);
    this.targetRy = ry;
  }

  snap(p: Vec3, ry: number) {
    this.setTarget(p, ry);
    this.group.position.copy(this.targetPos);
    this.group.rotation.y = ry;
  }

  update(dt: number, t: number) {
    const k = 1 - Math.pow(0.0001, dt);
    this.lastPos.copy(this.group.position);
    this.group.position.lerp(this.targetPos, k);
    this.speed = dt > 0 ? this.lastPos.distanceTo(this.group.position) / dt : 0;
    const delta =
      ((this.targetRy - this.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.group.rotation.y += delta * k;
    this.group.rotation.x = slopePitch(
      this.group.position.x,
      this.group.position.z,
      this.group.rotation.y,
    );
    applyCarWobble(this.group, t, dt, this.speed);
  }
}
