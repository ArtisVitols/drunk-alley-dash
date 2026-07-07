import * as THREE from 'three';
import type { Vec3 } from '../net/network';
import type { Obstacle, WorldGeom } from './scene';

export const PLAYER_COLORS = [0xff8c42, 0x7ddf64, 0x53a2ff, 0xff5d8f];

const MOVE_SPEED = 6;
const TURN_SPEED = 2.7;
const BODY_RADIUS = 0.45;

function makeNameSprite(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(name, 128, 32);
  ctx.fillStyle = '#f2ecdd';
  ctx.fillText(name, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(2.2, 0.55, 1);
  sprite.position.y = 2.6;
  return sprite;
}

interface Rig {
  rig: THREE.Group;
  thighL: THREE.Group;
  thighR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  head: THREE.Group;
  phase: number;
}

const std = (color: number, roughness = 0.75) =>
  new THREE.MeshStandardMaterial({ color, roughness });

function capsule(
  mat: THREE.Material,
  radius: number,
  length: number,
  y: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat);
  mesh.position.y = y;
  return mesh;
}

// Articulated drunk guy: jointed legs (thigh/knee/shoe), arms
// (shoulder/elbow/hand), face with drunk brows and a red nose, beanie,
// and a bottle permanently in the right hand. Faces +Z.
export function createPlayerMesh(colorIndex: number, name: string): THREE.Group {
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  const jacket = std(color, 0.8);
  const beanieColor = new THREE.Color(color).multiplyScalar(0.45).getHex();
  const beanieMat = std(beanieColor, 0.9);
  const pants = std(0x33353f, 0.9);
  const shirt = std(0xcfc4a6, 0.85);
  const skin = std(0xe8a97e, 0.8);
  const shoe = std(0x2a2118, 0.85);
  const dark = std(0x141414, 0.6);
  const white = std(0xf2f0e8, 0.5);

  const group = new THREE.Group();
  const rig = new THREE.Group();
  rig.name = 'rig';

  // --- legs -----------------------------------------------------------
  const makeLeg = (side: 1 | -1) => {
    const thigh = new THREE.Group();
    thigh.position.set(0.15 * side, 0.9, 0);
    thigh.add(capsule(pants, 0.105, 0.26, -0.22));
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    knee.add(capsule(pants, 0.085, 0.24, -0.19));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.3), shoe);
    foot.position.set(0, -0.37, 0.06);
    knee.add(foot);
    thigh.add(knee);
    rig.add(thigh);
    return { thigh, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- torso -----------------------------------------------------------
  const torso = capsule(jacket, 0.24, 0.34, 1.22);
  torso.scale.set(1.2, 1, 0.95);
  rig.add(torso);
  // Beer belly poking out of the jacket
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), shirt);
  belly.position.set(0, 1.1, 0.13);
  belly.scale.set(1.05, 0.85, 0.7);
  rig.add(belly);

  // --- arms -----------------------------------------------------------
  const makeArm = (side: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.33 * side, 1.44, 0);
    shoulder.rotation.z = -0.18 * side;
    shoulder.add(capsule(jacket, 0.08, 0.18, -0.16));
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    elbow.add(capsule(jacket, 0.07, 0.16, -0.14));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skin);
    hand.position.y = -0.3;
    elbow.add(hand);
    shoulder.add(elbow);
    rig.add(shoulder);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);
  // Bottle glued into the right hand
  const bottleMat = new THREE.MeshStandardMaterial({
    color: 0x7a4210,
    roughness: 0.25,
    emissive: 0x7a4210,
    emissiveIntensity: 0.2,
  });
  const bottle = new THREE.Group();
  const bottleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.24, 8), bottleMat);
  const bottleNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.1, 8), bottleMat);
  bottleNeck.position.y = 0.17;
  bottle.add(bottleBody, bottleNeck);
  bottle.position.set(0, -0.32, 0.09);
  bottle.rotation.x = -0.4;
  armR.elbow.add(bottle);
  armR.elbow.rotation.x = 0.7; // forearm raised, mid-swig posture

  // --- head ------------------------------------------------------------
  const head = new THREE.Group();
  head.position.y = 1.56;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 14), skin);
  skull.position.y = 0.26;
  skull.scale.set(0.95, 1.05, 0.95);
  head.add(skull);
  for (const side of [-1, 1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), white);
    eye.position.set(0.095 * side, 0.3, 0.185);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), dark);
    pupil.position.set(0.095 * side, 0.295, 0.232);
    // Droopy drunk eyebrows (outer ends sag)
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), dark);
    brow.position.set(0.1 * side, 0.375, 0.21);
    brow.rotation.z = 0.4 * side;
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), skin);
    ear.position.set(0.225 * side, 0.26, 0);
    head.add(eye, pupil, brow, ear);
  }
  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 8, 8),
    std(0xd94a4a, 0.55),
  );
  nose.position.set(0, 0.23, 0.225);
  head.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.02), dark);
  mouth.position.set(0.025, 0.13, 0.205);
  mouth.rotation.z = 0.25; // crooked grin
  head.add(mouth);
  // Beanie in a darker team color
  const beanieTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
    beanieMat,
  );
  beanieTop.position.y = 0.31;
  const beanieBand = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.255, 0.09, 14), beanieMat);
  beanieBand.position.y = 0.4;
  head.add(beanieTop, beanieBand);
  rig.add(head);

  group.add(rig, makeNameSprite(name));
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });

  const rigData: Rig = {
    rig,
    thighL: legL.thigh,
    thighR: legR.thigh,
    kneeL: legL.knee,
    kneeR: legR.knee,
    shoulderL: armL.shoulder,
    shoulderR: armR.shoulder,
    elbowL: armL.elbow,
    elbowR: armR.elbow,
    head,
    phase: Math.random() * Math.PI * 2,
  };
  group.userData.rig = rigData;
  return group;
}

// Drunk locomotion: staggering walk cycle with knee bends and arm
// swings; when idle, weight-shifting sway plus the occasional swig.
export function applyWobble(mesh: THREE.Group, t: number, moving: boolean) {
  const r = mesh.userData.rig as Rig | undefined;
  if (!r) return;
  const p = r.phase;

  if (moving) {
    const walk = t * 7.5 + p;
    const swing = Math.sin(walk);
    // Body: lurching tilt + bob
    r.rig.rotation.z = Math.sin(walk * 0.97) * 0.1;
    r.rig.rotation.x = 0.08 + Math.sin(walk * 0.63) * 0.05;
    r.rig.position.y = Math.abs(Math.cos(walk)) * 0.06;
    // Legs: opposite swings, knees bend on the back-swing
    r.thighL.rotation.x = swing * 0.62;
    r.thighR.rotation.x = -swing * 0.62;
    r.kneeL.rotation.x = -Math.max(0, -swing) * 0.85;
    r.kneeR.rotation.x = -Math.max(0, swing) * 0.85;
    // Arms: counter-swing; bottle arm stays half-raised
    r.shoulderL.rotation.x = -swing * 0.5;
    r.shoulderR.rotation.x = swing * 0.28;
    r.elbowL.rotation.x = 0.25 + Math.max(0, swing) * 0.3;
    r.elbowR.rotation.x = 0.7;
    // Head lolls around
    r.head.rotation.z = Math.sin(t * 2.3 + p) * 0.13;
    r.head.rotation.x = Math.sin(t * 1.7 + p) * 0.08;
  } else {
    // Idle: swaying on the spot, periodically raising the bottle
    const sip = Math.max(0, Math.sin(t * 1.1 + p));
    r.rig.rotation.z = Math.sin(t * 1.2 + p) * 0.05;
    r.rig.rotation.x = Math.sin(t * 0.8 + p) * 0.03;
    r.rig.position.y = 0;
    r.thighL.rotation.x = 0;
    r.thighR.rotation.x = 0;
    r.kneeL.rotation.x = 0;
    r.kneeR.rotation.x = 0;
    r.shoulderL.rotation.x = Math.sin(t * 1.2 + p) * 0.06;
    r.shoulderR.rotation.x = sip * 0.85;
    r.elbowL.rotation.x = 0.15;
    r.elbowR.rotation.x = 0.7 + sip * 0.9;
    r.head.rotation.x = -sip * 0.35 + Math.sin(t * 1.5 + p) * 0.05;
    r.head.rotation.z = Math.sin(t * 0.9 + p) * 0.08;
  }
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

// Circle-vs-circle pushout (cars against cars, walkers against cars).
export function collideCircles(pos: THREE.Vector3, radius: number, circles: Circle[]): boolean {
  let hit = false;
  for (const c of circles) {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const min = radius + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    hit = true;
    const d = Math.sqrt(d2);
    if (d > 1e-4) {
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    } else {
      pos.x = c.x + min;
    }
  }
  return hit;
}

// Circle-vs-world collision shared by walkers and cars. Returns true
// if the position had to be corrected (something was hit).
export function collideCircle(
  pos: THREE.Vector3,
  radius: number,
  world: WorldGeom,
  extraObstacles?: Obstacle[],
): boolean {
  let hit = false;
  const b = world.bounds;
  const clampedX = Math.min(b.maxX, Math.max(b.minX, pos.x));
  const clampedZ = Math.min(b.maxZ, Math.max(b.minZ, pos.z));
  if (clampedX !== pos.x || clampedZ !== pos.z) hit = true;
  pos.x = clampedX;
  pos.z = clampedZ;
  const all = extraObstacles ? world.obstacles.concat(extraObstacles) : world.obstacles;
  for (const o of all) {
    const cx = Math.min(o.x + o.hx, Math.max(o.x - o.hx, pos.x));
    const cz = Math.min(o.z + o.hz, Math.max(o.z - o.hz, pos.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Center inside the box — push out along the shallowest axis
      const pushX = o.hx + radius - Math.abs(pos.x - o.x);
      const pushZ = o.hz + radius - Math.abs(pos.z - o.z);
      if (pushX < pushZ) pos.x = o.x + Math.sign(pos.x - o.x || 1) * (o.hx + radius);
      else pos.z = o.z + Math.sign(pos.z - o.z || 1) * (o.hz + radius);
    }
  }
  return hit;
}

export class LocalController {
  pos = new THREE.Vector3(0, 0, 0);
  ry = 0;
  moving = false;
  private swayClock = Math.random() * 10;

  // fwd/turn are analog axes in [-1, 1]: keyboard sends ±1, the
  // touch joystick sends fractional values. `circles` are dynamic
  // round blockers (cars); `extraObstacles` dynamic AABBs (road junk).
  update(
    dt: number,
    fwd: number,
    turn: number,
    world: WorldGeom,
    circles: Circle[] = [],
    extraObstacles?: Obstacle[],
  ) {
    this.ry += turn * TURN_SPEED * dt;

    this.moving = Math.abs(fwd) > 0.08;
    if (this.moving) {
      this.swayClock += dt;
      // The drunk part: heading drifts on its own while walking
      this.ry += Math.sin(this.swayClock * 1.9) * 1.15 * dt;
      const step = MOVE_SPEED * fwd * dt;
      this.pos.x += Math.sin(this.ry) * step;
      this.pos.z += Math.cos(this.ry) * step;
    }
    collideCircle(this.pos, BODY_RADIUS, world, extraObstacles);
    collideCircles(this.pos, BODY_RADIUS, circles);
  }
}

export class RemoteAvatar {
  readonly group: THREE.Group;
  private targetPos = new THREE.Vector3();
  private targetRy = 0;
  private moving = false;
  private hasTarget = false;

  constructor(colorIndex: number, name: string) {
    this.group = createPlayerMesh(colorIndex, name);
  }

  setTarget(p: Vec3, ry: number, moving: boolean) {
    this.targetPos.set(p[0], p[1], p[2]);
    this.targetRy = ry;
    this.moving = moving;
    if (!this.hasTarget) {
      this.group.position.copy(this.targetPos);
      this.group.rotation.y = ry;
      this.hasTarget = true;
    }
  }

  update(dt: number, t: number) {
    if (!this.hasTarget) return;
    const k = 1 - Math.pow(0.0001, dt);
    this.group.position.lerp(this.targetPos, k);
    const delta =
      ((this.targetRy - this.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.group.rotation.y += delta * k;
    applyWobble(this.group, t, this.moving);
  }
}
