import * as THREE from 'three';
import type { Vec3 } from '../net/network';
import type { WorldGeom } from './scene';

export const PLAYER_COLORS = [0xff8c42, 0x7ddf64, 0x53a2ff, 0xff5d8f];

const MOVE_SPEED = 6;
const TURN_SPEED = 2.7;
const BODY_RADIUS = 0.45;

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

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
  sprite.position.y = 2.55;
  return sprite;
}

// Blocky drunk guy: capsule body, head with a red drunkard nose,
// a bottle in one hand. Faces +Z. The 'rig' child gets the wobble
// so it doesn't fight the group's Y rotation.
export function createPlayerMesh(colorIndex: number, name: string): THREE.Group {
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  const group = new THREE.Group();
  const rig = new THREE.Group();
  rig.name = 'rig';

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0b98c, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.7, 4, 12), bodyMat);
  body.position.y = 0.95;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), skinMat);
  head.position.y = 1.78;

  const nose = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xd94a4a, roughness: 0.6 }),
  );
  nose.position.set(0, 1.74, 0.28);

  const capMat = new THREE.MeshStandardMaterial({ color: 0x2a2a35, roughness: 0.8 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), capMat);
  cap.position.y = 1.82;

  const armGeo = new THREE.CapsuleGeometry(0.1, 0.5, 3, 8);
  const leftArm = new THREE.Mesh(armGeo, bodyMat);
  leftArm.position.set(-0.5, 1.15, 0.1);
  leftArm.rotation.z = 0.7;
  const rightArm = new THREE.Mesh(armGeo, bodyMat);
  rightArm.position.set(0.52, 1.2, 0.15);
  rightArm.rotation.z = -0.9;
  rightArm.rotation.x = -0.4;

  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.3 }),
  );
  bottle.position.set(0.72, 1.42, 0.3);

  rig.add(body, head, nose, cap, leftArm, rightArm, bottle);
  group.add(rig, makeNameSprite(name));
  return group;
}

// Drunk stagger: body sways and bobs, harder when moving.
export function applyWobble(mesh: THREE.Group, t: number, moving: boolean) {
  const rig = mesh.getObjectByName('rig');
  if (!rig) return;
  if (moving) {
    rig.rotation.z = Math.sin(t * 7.3) * 0.11;
    rig.rotation.x = Math.sin(t * 5.1) * 0.06;
    rig.position.y = Math.abs(Math.sin(t * 7.3)) * 0.08;
  } else {
    rig.rotation.z = Math.sin(t * 1.3) * 0.04;
    rig.rotation.x = Math.sin(t * 0.9) * 0.02;
    rig.position.y = 0;
  }
}

function collideWorld(pos: THREE.Vector3, world: WorldGeom) {
  const b = world.bounds;
  pos.x = Math.min(b.maxX, Math.max(b.minX, pos.x));
  pos.z = Math.min(b.maxZ, Math.max(b.minZ, pos.z));
  for (const o of world.obstacles) {
    const cx = Math.min(o.x + o.hx, Math.max(o.x - o.hx, pos.x));
    const cz = Math.min(o.z + o.hz, Math.max(o.z - o.hz, pos.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= BODY_RADIUS * BODY_RADIUS) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * BODY_RADIUS;
      pos.z = cz + (dz / d) * BODY_RADIUS;
    } else {
      // Center inside the box — push out along the shallowest axis
      const pushX = o.hx + BODY_RADIUS - Math.abs(pos.x - o.x);
      const pushZ = o.hz + BODY_RADIUS - Math.abs(pos.z - o.z);
      if (pushX < pushZ) pos.x = o.x + Math.sign(pos.x - o.x || 1) * (o.hx + BODY_RADIUS);
      else pos.z = o.z + Math.sign(pos.z - o.z || 1) * (o.hz + BODY_RADIUS);
    }
  }
}

export class LocalController {
  pos = new THREE.Vector3(0, 0, 0);
  ry = 0;
  moving = false;
  private swayClock = Math.random() * 10;

  update(dt: number, input: InputState, world: WorldGeom) {
    const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.ry += turn * TURN_SPEED * dt;

    const fwd = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    this.moving = fwd !== 0;
    if (this.moving) {
      this.swayClock += dt;
      // The drunk part: heading drifts on its own while walking
      this.ry += Math.sin(this.swayClock * 1.9) * 1.15 * dt;
      const step = MOVE_SPEED * fwd * dt;
      this.pos.x += Math.sin(this.ry) * step;
      this.pos.z += Math.cos(this.ry) * step;
    }
    collideWorld(this.pos, world);
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
