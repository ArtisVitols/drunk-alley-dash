import * as THREE from 'three';
import type { CarKind, PlayerState, Vec3 } from '../net/network';
import type { Obstacle, WorldGeom } from './scene';
import type { Circle } from './player';
import { PLAYER_COLORS, collideCircle, collideCircles } from './player';
import { elevation } from './road';
import { carPaintTexture, plateTexture } from './textures';

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
  // The sedan again, but dragging a camper: quicker than the RV, wallows
  caravan: { max: 14, reverse: 5, accel: 12, turn: 2.0, radius: 1.1, sway: 0.55 },
};

const DRAG = 0.55;

export const carRadius = (kind: CarKind) => CAR_STATS[kind].radius;

// Towing geometry (caravan): the camper articulates around a hitch
// behind the sedan; its axle chases the hitch like a real trailer.
const HITCH_OFFSET = 2.0; // car center → hitch ball
const TRAILER_LEN = 2.7; // hitch → camper axle
const TRAILER_BODY = 2.2; // hitch → camper body center
export const TRAILER_RADIUS = 1.35;
const MAX_HITCH_BEND = 1.15; // rad; past this it would jackknife into the car

const wrapAngle = (a: number) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

// Plain math (host + collision lists use it on network Vec3s, no THREE)
export function trailerCenterXZ(
  x: number,
  z: number,
  ry: number,
  tr: number,
): [number, number] {
  const hx = x - Math.sin(ry) * HITCH_OFFSET;
  const hz = z - Math.cos(ry) * HITCH_OFFSET;
  return [hx - Math.sin(tr) * TRAILER_BODY, hz - Math.cos(tr) * TRAILER_BODY];
}

export type Surface = 'city' | 'asphalt' | 'sand' | 'gravel' | 'mud' | 'grass';

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
  trailer?: THREE.Group; // articulated camper, pivoted at the hitch
}

const std = (color: number, roughness = 0.5, metalness = 0.4) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const GLASS = () => {
  const mat = std(0x1c2126, 0.15, 0.7);
  mat.envMapIntensity = 1.4; // windows catch the sky/neon
  return mat;
};

// Body paint: tinted by color, worn by the shared grime/scratch canvas
const paint = (color: number, roughness = 0.4, metalness = 0.5) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, map: carPaintTexture() });

function addWheels(
  body: THREE.Group,
  wheels: THREE.Mesh[],
  radius: number,
  positions: [number, number][],
) {
  const geo = new THREE.CylinderGeometry(radius, radius, 0.24, 12);
  const mat = std(0x15161a, 0.8, 0.2);
  // Hubcap pokes out both faces and spins with the wheel
  const capGeo = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 0.27, 8);
  const capMat = std(0x8f949c, 0.35, 0.85);
  for (const [x, z] of positions) {
    const wheel = new THREE.Mesh(geo, mat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, radius, z);
    wheel.add(new THREE.Mesh(capGeo, capMat));
    body.add(wheel);
    wheels.push(wheel);
  }
}

// Deterministic-ish Lithuanian plate per mesh
const plateText = () => `DAD ${Math.floor(100 + Math.random() * 900)}`;

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
  // Night-only headlight beams: additive cones reaching out ahead,
  // toggled by setCarNight()
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b0,
    transparent: true,
    opacity: 0.055,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.06), headMat);
    head.position.set(halfW * 0.66 * side, y, front);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.06), tailMat);
    tail.position.set(halfW * 0.66 * side, y, rear);
    // Narrow at the lamp, spreading forward and dipping to the road
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 4.5, 8, 1, true), beamMat);
    beam.rotation.x = Math.PI / 2 - 0.09;
    beam.position.set(halfW * 0.66 * side, y - 0.18, front + 2.25);
    beam.name = 'headbeam';
    beam.visible = false;
    body.add(head, tail, beam);
  }
  // License plates front + rear
  const text = plateText();
  const plateGeo = new THREE.PlaneGeometry(0.5, 0.125);
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(text), roughness: 0.4 });
  const plateF = new THREE.Mesh(plateGeo, plateMat);
  plateF.position.set(0, y - 0.18, front + 0.04);
  const plateR = new THREE.Mesh(plateGeo, plateMat);
  plateR.position.set(0, y - 0.18, rear - 0.04);
  plateR.rotation.y = Math.PI;
  body.add(plateF, plateR);
}

// Toggle night dressing (headlight beams) on a car mesh
export function setCarNight(carGroup: THREE.Group, night: boolean) {
  carGroup.traverse((o) => {
    if (o.name === 'headbeam') o.visible = night;
  });
}

// Dark dashboard shelf + steering wheel visible through the windshield
function addDashboard(body: THREE.Group, y: number, z: number, width: number) {
  const dash = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 0.35), std(0x1a1c20, 0.8, 0.1));
  dash.position.set(0, y, z);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 12), std(0x26282e, 0.6, 0.2));
  wheel.position.set(-width * 0.28, y + 0.12, z - 0.12);
  wheel.rotation.x = -Math.PI / 2 + 0.5;
  body.add(dash, wheel);
}

// Four very different rides. All face +Z.
function buildBody(kind: CarKind, body: THREE.Group, wheels: THREE.Mesh[]) {
  if (kind === 'sedan' || kind === 'caravan') {
    // The tow car wears green so nobody confuses it with a plain sedan
    const paintMat = paint(kind === 'caravan' ? 0x3f8f5f : 0xd9534f, 0.35, 0.55);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 3.1), paintMat);
    hull.position.y = 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.52, 1.5), GLASS());
    cabin.position.set(0, 1.06, -0.15);
    const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.16, 0.14), std(0x9aa0a8, 0.3, 0.8));
    bumperF.position.set(0, 0.38, 1.58);
    const bumperR = bumperF.clone();
    bumperR.position.z = -1.58;
    body.add(hull, cabin, bumperF, bumperR);
    addDashboard(body, 0.92, 0.45, 1.3);
    addWheels(body, wheels, 0.3, [[-0.72, 1.0], [0.72, 1.0], [-0.72, -1.0], [0.72, -1.0]]);
    addLights(body, 0.75, 0.62, 1.56, -1.56);
  } else if (kind === 'van') {
    const paintMat = paint(0x4f7bd9, 0.4, 0.5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 3.5), paintMat);
    box.position.y = 1.05;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.5), paintMat);
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
    const cream = paint(0xe8e4d8, 0.55, 0.2);
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
    addDashboard(body, 1.62, 2.75, 1.9);
    addWheels(body, wheels, 0.38, [[-1.05, 2.2], [1.05, 2.2], [-1.05, -2.0], [1.05, -2.0]]);
    addLights(body, 1.15, 0.65, 3.12, -3.12);
  } else {
    // truck — cab up front, open cargo bed in the back
    const paintMat = paint(0xd9b44f, 0.4, 0.5);
    const bedMat = std(0x5a5e64, 0.7, 0.5);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 4.4), std(0x2a2d33, 0.7, 0.5));
    chassis.position.y = 0.5;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.5), paintMat);
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

// Teardrop-ish camper hanging off the hitch. Local origin IS the hitch
// ball, so rotating this group articulates the whole trailer; the body
// sits behind it, single axle under the middle.
function buildTrailer(pivot: THREE.Group, wheels: THREE.Mesh[]) {
  const cream = paint(0xece7d9, 0.55, 0.2);
  const accent = std(0x4a7a9d, 0.5, 0.3);
  // Drawbar from the hitch back to the box
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 1.1), std(0x2a2d33, 0.6, 0.6));
  bar.position.set(0, 0.42, -0.5);
  const barL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.9), std(0x2a2d33, 0.6, 0.6));
  barL.position.set(-0.28, 0.42, -0.62);
  barL.rotation.y = -0.5;
  const barR = barL.clone();
  barR.position.x = 0.28;
  barR.rotation.y = 0.5;
  // Rounded box body
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.45, 2.9), cream);
  box.position.set(0, 1.22, -TRAILER_BODY);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.96, 2.86, 3, 1), cream);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.x = Math.PI / 2;
  roof.scale.y = 0.32;
  roof.position.set(0, 1.95, -TRAILER_BODY);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.26, 2.92), accent);
  stripe.position.set(0, 0.86, -TRAILER_BODY);
  // Window band + rear window + door
  const windowBand = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.42, 1.7), GLASS());
  windowBand.position.set(0, 1.5, -TRAILER_BODY - 0.2);
  const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 0.06), GLASS());
  rearWin.position.set(0, 1.5, -TRAILER_BODY - 1.48);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.25, 0.62), std(0xb8b0a0, 0.6, 0.2));
  door.position.set(0.96, 1.05, -TRAILER_BODY + 0.55);
  // Roof vent + jockey wheel up front
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.45), std(0xb8b0a0, 0.6, 0.2));
  vent.position.set(0, 2.28, -TRAILER_BODY - 0.5);
  const jockey = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 8), std(0x15161a, 0.8, 0.2));
  jockey.rotation.z = Math.PI / 2;
  jockey.position.set(0, 0.12, -0.35);
  // Homely curtains glowing faintly behind the glass
  const curtainMat = new THREE.MeshStandardMaterial({
    color: 0xc9a86a,
    roughness: 0.9,
    emissive: 0x8a6a30,
    emissiveIntensity: 0.25,
  });
  for (const side of [-1, 1]) {
    for (const cz of [-TRAILER_BODY + 0.35, -TRAILER_BODY - 0.75]) {
      const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 0.5), curtainMat);
      curtain.position.set(0.93 * side, 1.5, cz);
      pivot.add(curtain);
    }
  }
  // Rear plate
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.125),
    new THREE.MeshStandardMaterial({ map: plateTexture(plateText()), roughness: 0.4 }),
  );
  plate.position.set(0, 0.55, -TRAILER_BODY - 1.51);
  plate.rotation.y = Math.PI;
  pivot.add(plate);
  pivot.add(bar, barL, barR, box, roof, stripe, windowBand, rearWin, door, vent, jockey);
  // Single axle
  const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 12);
  const mat = std(0x15161a, 0.8, 0.2);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(geo, mat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0.98 * side, 0.3, -TRAILER_LEN);
    pivot.add(wheel);
    wheels.push(wheel);
  }
  // Tail lights
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x7a1212,
    emissive: 0xd92222,
    emissiveIntensity: 1.1,
  });
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), tailMat);
    tail.position.set(0.7 * side, 0.75, -TRAILER_BODY - 1.5);
    pivot.add(tail);
  }
}

// Passenger window/bed anchor points (car-local; slot 0..2 for
// occupants 1..3 — the driver is inside, invisible, steering).
// `trailer` slots anchor to the camper and articulate with it.
const SLOT_SPECS: Record<
  CarKind,
  { x: number; y: number; z: number; mode: 'lean' | 'stand'; trailer?: boolean }[]
> = {
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
  // One up front with the driver, two living it up in the camper
  // (trailer-local coords, z measured back from the hitch)
  caravan: [
    { x: 0.78, y: 1.0, z: 0.45, mode: 'lean' },
    { x: 0.99, y: 1.45, z: -1.9, mode: 'lean', trailer: true },
    { x: -0.99, y: 1.45, z: -2.6, mode: 'lean', trailer: true },
  ],
};

export function createCarMesh(kind: CarKind): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  buildBody(kind, body, wheels);

  // The camper articulates independently of the car body, so it hangs
  // off the group (not the swaying body), pivoted at the hitch ball
  let trailer: THREE.Group | undefined;
  if (kind === 'caravan') {
    trailer = new THREE.Group();
    trailer.position.set(0, 0, -2.0); // HITCH_OFFSET behind the car center
    buildTrailer(trailer, wheels);
    group.add(trailer);
  }

  const slots: Slot[] = SLOT_SPECS[kind].map((spec) => {
    const anchor = new THREE.Group();
    anchor.position.set(spec.x, spec.y, spec.z);
    (spec.trailer && trailer ? trailer : body).add(anchor);
    return { anchor, mode: spec.mode, side: (spec.x >= 0 ? 1 : -1) as 1 | -1, playerId: null };
  });

  group.add(body);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  group.userData.carRig = { body, wheels, slots, trailer } satisfies CarRig;
  return group;
}

// Pose a car mesh's camper from world yaws (driver sim or network state)
export function setTrailerAngle(carGroup: THREE.Group, ry: number, tr: number) {
  const rig = carGroup.userData.carRig as CarRig | undefined;
  if (rig?.trailer) rig.trailer.rotation.y = wrapAngle(tr - ry);
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

const trailerTmp = new THREE.Vector3();

export class CarController {
  pos = new THREE.Vector3();
  ry = 0;
  speed = 0;
  trailerRy = 0; // camper heading; only meaningful for towing kinds
  crashIntensity = 0; // set on a hard hit; consumer resets after use
  private kind: CarKind = 'sedan';
  private stats = CAR_STATS.sedan;
  private swayClock = Math.random() * 10;

  get towing(): boolean {
    return this.kind === 'caravan';
  }

  reset(p: Vec3, ry: number, kind: CarKind, tr?: number) {
    this.pos.set(p[0], 0, p[2]);
    this.ry = ry;
    this.speed = 0;
    this.kind = kind;
    this.stats = CAR_STATS[kind];
    this.trailerRy = tr ?? ry;
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
    // Loose surfaces slow the ride: grass bogs it right down, mud is a
    // slog, gravel just shaves the top end
    const maxSpeed =
      s.max *
      (surface === 'grass' ? 0.35 : surface === 'mud' ? 0.55 : surface === 'gravel' ? 0.82 : 1);
    this.speed += throttle * s.accel * dt;
    this.speed -= this.speed * DRAG * dt;
    this.speed = Math.min(maxSpeed, Math.max(-s.reverse, this.speed));
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;

    const grip = Math.min(1, Math.abs(this.speed) / 7);
    // Steering only bites when rolling; reversing flips it like a real car
    this.ry += steer * s.turn * grip * Math.sign(this.speed || 1) * dt;
    // Drunk at the wheel: the car pulls side to side on its own —
    // worse on loose sand and gravel, worst wallowing through mud
    this.swayClock += dt;
    const sway =
      s.sway * (surface === 'sand' ? 1.35 : surface === 'gravel' ? 1.2 : surface === 'mud' ? 1.5 : 1);
    this.ry += Math.sin(this.swayClock * 1.4) * sway * grip * dt;

    this.pos.x += Math.sin(this.ry) * this.speed * dt;
    this.pos.z += Math.cos(this.ry) * this.speed * dt;
    const hitWorld = collideCircle(this.pos, s.radius, world, extraObstacles);
    const hitCars = collideCircles(this.pos, s.radius, circles);
    if (hitWorld || hitCars) {
      if (Math.abs(this.speed) > 2.5) this.crashIntensity = Math.abs(this.speed);
      this.speed *= Math.pow(0.02, dt); // crunch — bleed speed fast
    }
    if (this.towing) this.updateTrailer(dt, world, circles, extraObstacles);
  }

  // Kinematic tow: the camper yaws so its axle chases the hitch.
  // Driving forward it settles behind the car; reversing folds it
  // toward the jackknife clamp (backing a trailer is HARD, as in life).
  private updateTrailer(
    dt: number,
    world: WorldGeom,
    circles: Circle[],
    extraObstacles?: Obstacle[],
  ) {
    this.trailerRy += (this.speed / TRAILER_LEN) * Math.sin(this.ry - this.trailerRy) * dt;
    const bend = wrapAngle(this.ry - this.trailerRy);
    if (bend > MAX_HITCH_BEND) this.trailerRy = this.ry - MAX_HITCH_BEND;
    else if (bend < -MAX_HITCH_BEND) this.trailerRy = this.ry + MAX_HITCH_BEND;

    // The camper hits things too: shove the whole rig by its pushout
    const [cx, cz] = trailerCenterXZ(this.pos.x, this.pos.z, this.ry, this.trailerRy);
    trailerTmp.set(cx, 0, cz);
    const hitWorld = collideCircle(trailerTmp, TRAILER_RADIUS, world, extraObstacles);
    const hitCars = collideCircles(trailerTmp, TRAILER_RADIUS, circles);
    if (hitWorld || hitCars) {
      this.pos.x += trailerTmp.x - cx;
      this.pos.z += trailerTmp.z - cz;
      if (Math.abs(this.speed) > 2.5) this.crashIntensity = Math.abs(this.speed);
      this.speed *= Math.pow(0.02, dt);
    }
  }
}

// Interpolates other players' cars between network updates.
export class RemoteCar {
  readonly group: THREE.Group;
  private targetPos = new THREE.Vector3();
  private targetRy = 0;
  private targetTr = 0;
  private trailerRy = 0;
  private lastPos = new THREE.Vector3();
  private speed = 0;

  constructor(kind: CarKind) {
    this.group = createCarMesh(kind);
  }

  get currentSpeed(): number {
    return this.speed;
  }

  setTarget(p: Vec3, ry: number, tr?: number) {
    // y is derived from terrain, never from the network
    this.targetPos.set(p[0], elevation(p[0], p[2]), p[2]);
    this.targetRy = ry;
    this.targetTr = tr ?? ry;
  }

  snap(p: Vec3, ry: number, tr?: number) {
    this.setTarget(p, ry, tr);
    this.group.position.copy(this.targetPos);
    this.group.rotation.y = ry;
    this.trailerRy = this.targetTr;
    setTrailerAngle(this.group, ry, this.trailerRy);
  }

  update(dt: number, t: number) {
    const k = 1 - Math.pow(0.0001, dt);
    this.lastPos.copy(this.group.position);
    this.group.position.lerp(this.targetPos, k);
    this.speed = dt > 0 ? this.lastPos.distanceTo(this.group.position) / dt : 0;
    const delta =
      ((this.targetRy - this.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.group.rotation.y += delta * k;
    this.trailerRy += wrapAngle(this.targetTr - this.trailerRy) * k;
    setTrailerAngle(this.group, this.group.rotation.y, this.trailerRy);
    this.group.rotation.x = slopePitch(
      this.group.position.x,
      this.group.position.z,
      this.group.rotation.y,
    );
    applyCarWobble(this.group, t, dt, this.speed);
  }
}
