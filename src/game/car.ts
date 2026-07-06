import * as THREE from 'three';
import type { Vec3 } from '../net/network';
import type { WorldGeom } from './scene';
import { collideCircle } from './player';

export const CAR_COLORS = [0xd9534f, 0x4f7bd9, 0xd9b44f, 0x5cb85c];

const MAX_SPEED = 15;
const REVERSE_MAX = 6;
const ACCEL = 14;
const DRAG = 0.55; // steady-state ACCEL/DRAG > MAX_SPEED so the clamp decides
const TURN_RATE = 2.1;
const CAR_RADIUS = 1.15;

interface CarRig {
  body: THREE.Group;
  wheels: THREE.Mesh[];
}

const std = (color: number, roughness = 0.5, metalness = 0.4) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

// Boxy old Soviet-era sedan, the kind still parked in every Vilnius
// courtyard. Faces +Z like the players.
export function createCarMesh(index: number): THREE.Group {
  const color = CAR_COLORS[index % CAR_COLORS.length];
  const paint = std(color, 0.35, 0.55);
  const group = new THREE.Group();
  const body = new THREE.Group();

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 3.1), paint);
  hull.position.y = 0.55;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.12, 0.8), paint);
  hood.position.set(0, 0.86, 1.05);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.12, 0.6), paint);
  trunk.position.set(0, 0.86, -1.15);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, 0.52, 1.5),
    std(0x1c2126, 0.15, 0.7), // glass-dark
  );
  cabin.position.set(0, 1.06, -0.15);
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.16, 0.14), std(0x9aa0a8, 0.3, 0.8));
  bumperF.position.set(0, 0.38, 1.58);
  const bumperR = bumperF.clone();
  bumperR.position.z = -1.58;
  body.add(hull, hood, trunk, cabin, bumperF, bumperR);

  // Headlights & taillights (emissive so they read at night)
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
    head.position.set(0.5 * side, 0.62, 1.56);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.06), tailMat);
    tail.position.set(0.5 * side, 0.62, -1.56);
    body.add(head, tail);
  }

  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 12);
  const wheelMat = std(0x15161a, 0.8, 0.2);
  for (const [sx, sz] of [
    [-0.72, 1.0], [0.72, 1.0], [-0.72, -1.0], [0.72, -1.0],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx, 0.3, sz);
    body.add(wheel);
    wheels.push(wheel);
  }

  group.add(body);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  group.userData.carRig = { body, wheels } satisfies CarRig;
  return group;
}

// Suspension sway + spinning wheels; sways harder the faster (and
// drunker) you go.
export function applyCarWobble(mesh: THREE.Group, t: number, dt: number, speed: number) {
  const rig = mesh.userData.carRig as CarRig | undefined;
  if (!rig) return;
  const k = Math.min(1, Math.abs(speed) / MAX_SPEED);
  rig.body.rotation.z = Math.sin(t * 3.1) * 0.05 * k;
  rig.body.rotation.x = Math.sin(t * 2.3) * 0.025 * k - speed * 0.0016;
  for (const wheel of rig.wheels) wheel.rotation.x += (speed * dt) / 0.3;
}

export class CarController {
  pos = new THREE.Vector3();
  ry = 0;
  speed = 0;
  private swayClock = Math.random() * 10;

  reset(p: Vec3, ry: number) {
    this.pos.set(p[0], 0, p[2]);
    this.ry = ry;
    this.speed = 0;
  }

  update(dt: number, throttle: number, steer: number, world: WorldGeom) {
    this.speed += throttle * ACCEL * dt;
    this.speed -= this.speed * DRAG * dt;
    this.speed = Math.min(MAX_SPEED, Math.max(-REVERSE_MAX, this.speed));
    if (Math.abs(this.speed) < 0.05 && throttle === 0) this.speed = 0;

    const k = Math.min(1, Math.abs(this.speed) / 7);
    // Steering only bites when rolling; reversing flips it like a real car
    this.ry += steer * TURN_RATE * k * Math.sign(this.speed || 1) * dt;
    // Drunk at the wheel: the car pulls side to side on its own
    this.swayClock += dt;
    this.ry += Math.sin(this.swayClock * 1.4) * 0.55 * k * dt;

    this.pos.x += Math.sin(this.ry) * this.speed * dt;
    this.pos.z += Math.cos(this.ry) * this.speed * dt;
    if (collideCircle(this.pos, CAR_RADIUS, world)) {
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

  constructor(index: number) {
    this.group = createCarMesh(index);
  }

  setTarget(p: Vec3, ry: number) {
    this.targetPos.set(p[0], p[1], p[2]);
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
    applyCarWobble(this.group, t, dt, this.speed);
  }
}
