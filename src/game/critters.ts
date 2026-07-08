import * as THREE from 'three';
import { GATE_Z, ROAD_HALF_WIDTH, elevation, nearestRoadT, sampleRoad } from './road';
import type { AnimalKind, Sound } from './sound';

// Ambient wildlife: strays darting across wherever the local player
// happens to be. Pure client-side flavor — every player sees their own
// critters, nothing is synced and nothing collides… except the wheels:
// any vehicle moving fast enough flattens them where they stand.

const std = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });

interface Critter {
  group: THREE.Group;
  kind: AnimalKind;
  vel: THREE.Vector3;
  life: number;
  phase: number;
  legs: THREE.Object3D[];
  tail: THREE.Object3D | null;
  hops: boolean;
  dead: boolean;
}

// A vehicle footprint that can squash critters (cab or towed camper)
export interface KillCircle {
  x: number;
  z: number;
  r: number;
  speed: number;
}

const KILL_SPEED = 2.5; // slower than this just shoos them

function buildCritter(kind: AnimalKind): {
  group: THREE.Group;
  legs: THREE.Object3D[];
  tail: THREE.Object3D | null;
} {
  const group = new THREE.Group();
  const legs: THREE.Object3D[] = [];
  let tail: THREE.Object3D | null = null;

  const spec = {
    cat: { body: 0x565660, size: 1.0, legLen: 0.16 },
    dog: { body: 0x8a6440, size: 1.5, legLen: 0.24 },
    squirrel: { body: 0xa05a28, size: 0.55, legLen: 0.08 },
    raccoon: { body: 0x77787c, size: 0.95, legLen: 0.14 },
    rat: { body: 0x3c3a40, size: 0.45, legLen: 0.05 },
  }[kind];
  const s = spec.size;
  const bodyMat = std(spec.body);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11 * s, 0.3 * s, 4, 8), bodyMat);
  body.rotation.x = Math.PI / 2; // capsule lying along z (facing +z)
  body.position.y = spec.legLen + 0.1 * s;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 8, 6), bodyMat);
  head.position.set(0, spec.legLen + 0.16 * s, 0.24 * s);
  group.add(head);

  // ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.035 * s, 0.08 * s, 4),
      kind === 'rat' ? std(0xd0a0a8) : bodyMat,
    );
    ear.position.set(0.055 * s * side, spec.legLen + 0.26 * s, 0.22 * s);
    group.add(ear);
  }

  if (kind === 'dog') {
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, 0.06 * s, 0.12 * s), bodyMat);
    snout.position.set(0, spec.legLen + 0.13 * s, 0.34 * s);
    group.add(snout);
  }
  if (kind === 'raccoon') {
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.19 * s, 0.045 * s, 0.05 * s), std(0x1c1c22));
    mask.position.set(0, spec.legLen + 0.17 * s, 0.31 * s);
    group.add(mask);
  }

  // legs
  const legGeo = new THREE.CylinderGeometry(0.02 * s, 0.02 * s, spec.legLen * 2, 5);
  for (const [lx, lz] of [
    [-0.08, 0.14], [0.08, 0.14], [-0.08, -0.14], [0.08, -0.14],
  ]) {
    const leg = new THREE.Mesh(legGeo, bodyMat);
    leg.position.set(lx * s, spec.legLen, lz * s);
    group.add(leg);
    legs.push(leg);
  }

  // tail
  if (kind === 'squirrel') {
    const bushy = new THREE.Mesh(new THREE.CapsuleGeometry(0.07 * s, 0.22 * s, 4, 8), std(0xb46a30));
    bushy.position.set(0, spec.legLen + 0.26 * s, -0.28 * s);
    bushy.rotation.x = -0.5;
    tail = bushy;
  } else if (kind === 'raccoon') {
    const ringed = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045 * s, 0.055 * s, 0.09 * s, 6),
        i % 2 ? std(0x2a2a30) : bodyMat,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.z = -0.05 * s - i * 0.085 * s;
      ringed.add(ring);
    }
    ringed.position.set(0, spec.legLen + 0.12 * s, -0.24 * s);
    ringed.rotation.x = 0.35;
    tail = ringed;
  } else {
    const thin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012 * s, 0.025 * s, 0.3 * s, 5),
      kind === 'rat' ? std(0xc79aa2) : bodyMat,
    );
    thin.position.set(0, spec.legLen + (kind === 'cat' ? 0.2 : 0.1) * s, -0.26 * s);
    thin.rotation.x = kind === 'cat' ? -0.9 : 1.1; // cat: tail up
    tail = thin;
  }
  if (tail) group.add(tail);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { group, legs, tail };
}

const SPEED: Record<AnimalKind, number> = {
  cat: 4.5,
  dog: 5,
  squirrel: 5.5,
  raccoon: 2.6,
  rat: 4,
};

export class Critters {
  private active: Critter[] = [];
  private timer = 3;

  constructor(
    private scene: THREE.Scene,
    private sound: Sound,
  ) {}

  private spawn(px: number, pz: number) {
    let kind: AnimalKind;
    let start: THREE.Vector3;
    let dir: THREE.Vector3;
    let span: number;
    const roll = Math.random();

    if (pz < 30 && Math.abs(px) < 8) {
      // In the alley: rats own the place, the odd cat
      kind = roll < 0.65 ? 'rat' : 'cat';
      const z = pz + (Math.random() * 24 - 12);
      const side = Math.random() < 0.5 ? -1 : 1;
      start = new THREE.Vector3(7 * side, 0, Math.max(-28, Math.min(28, z)));
      dir = new THREE.Vector3(-side, 0, 0);
      span = 14;
    } else if (pz < GATE_Z) {
      // City streets: cats and dogs
      kind = roll < 0.5 ? 'cat' : 'dog';
      const z = Math.max(32, Math.min(118, pz + (Math.random() * 30 - 15)));
      const side = Math.random() < 0.5 ? -1 : 1;
      start = new THREE.Vector3(px + 14 * side, 0, z);
      dir = new THREE.Vector3(-side, 0, 0);
      span = 28;
    } else {
      // Country road: forest folk crossing
      kind = roll < 0.4 ? 'squirrel' : roll < 0.7 ? 'raccoon' : roll < 0.85 ? 'dog' : 'cat';
      const t = Math.min(0.97, Math.max(0.01, nearestRoadT(px, pz) + (Math.random() * 0.08 - 0.02)));
      const s = sampleRoad(t);
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = ROAD_HALF_WIDTH + 1.5;
      const nx = Math.cos(s.angle) * side;
      const nz = -Math.sin(s.angle) * side;
      start = new THREE.Vector3(s.p[0] + nx * off, 0, s.p[2] + nz * off);
      dir = new THREE.Vector3(-nx, 0, -nz);
      span = off * 2;
    }

    const { group, legs, tail } = buildCritter(kind);
    group.position.copy(start);
    group.position.y = elevation(start.x, start.z);
    group.rotation.y = Math.atan2(dir.x, dir.z);
    this.scene.add(group);
    const speed = SPEED[kind] * (0.85 + Math.random() * 0.3);
    this.active.push({
      group,
      kind,
      vel: dir.multiplyScalar(speed),
      life: span / speed,
      phase: Math.random() * 10,
      legs,
      tail,
      hops: kind === 'squirrel' || kind === 'rat',
      dead: false,
    });
    if (Math.random() < 0.65) this.sound.playAnimal(kind);
  }

  // Flatten a critter under the wheels: pancake pose, legs splayed,
  // left lying on the road for a few seconds before despawning.
  private squash(critter: Critter) {
    critter.dead = true;
    this.kills++;
    critter.vel.set(0, 0, 0);
    critter.life = 5;
    const g = critter.group;
    g.scale.y = 0.22;
    g.position.y = elevation(g.position.x, g.position.z);
    critter.legs.forEach((leg, i) => {
      leg.rotation.x = 0;
      leg.rotation.z = (i % 2 === 0 ? 1 : -1) * 1.35;
    });
    if (critter.tail) critter.tail.rotation.z = 0.8;
    this.sound.playSquash();
  }

  update(
    dt: number,
    t: number,
    px: number,
    pz: number,
    inAlley: boolean,
    killers: KillCircle[] = [],
  ) {
    this.timer -= dt;
    if (this.timer <= 0 && this.active.length < 4) {
      this.spawn(px, pz);
      // rats are busier than the rest of the fauna
      this.timer = inAlley ? 2.5 + Math.random() * 4 : 5 + Math.random() * 8;
    }

    this.active = this.active.filter((critter) => {
      critter.life -= dt;
      if (critter.life <= 0) {
        this.scene.remove(critter.group);
        return false;
      }
      const g = critter.group;
      if (critter.dead) return true; // roadkill just lies there
      g.position.addScaledVector(critter.vel, dt);
      const bounce = critter.hops ? Math.abs(Math.sin((t + critter.phase) * 9)) * 0.12 : 0;
      g.position.y = elevation(g.position.x, g.position.z) + bounce;
      const swing = Math.sin((t + critter.phase) * 14);
      critter.legs.forEach((leg, i) => {
        leg.rotation.x = swing * 0.7 * (i % 2 === 0 ? 1 : -1);
      });
      if (critter.tail) critter.tail.rotation.z = Math.sin((t + critter.phase) * 6) * 0.25;
      for (const c of killers) {
        if (Math.abs(c.speed) < KILL_SPEED) continue;
        const dx = g.position.x - c.x;
        const dz = g.position.z - c.z;
        const min = c.r + 0.35;
        if (dx * dx + dz * dz < min * min) {
          this.squash(critter);
          break;
        }
      }
      return true;
    });
  }

  kills = 0;

  get count(): number {
    return this.active.length;
  }

  // Live (not yet squashed) critter positions — for the test handle
  get positions(): [number, number][] {
    return this.active
      .filter((c) => !c.dead)
      .map((c) => [c.group.position.x, c.group.position.z]);
  }
}
