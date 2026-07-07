import * as THREE from 'three';
import type { RoadObstacleKind, RoadObstacleState } from '../net/network';
import type { Obstacle } from './scene';
import { glowTexture } from './fx';
import { elevation } from './road';

const std = (color: number, roughness = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness });

// Obstacles lie ACROSS the road: long axis ~8 units along local X,
// the group's rotation.y aligns local X with the road's width.
const LONG_HALF = 4.2;
const SHORT_HALF = 0.9;

function buildMesh(kind: RoadObstacleKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'log') {
    const wood = std(0x6b4a26);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 8.2, 10), wood);
    trunk.rotation.z = Math.PI / 2;
    trunk.position.y = 0.55;
    g.add(trunk);
    for (const [x, a] of [
      [-2.5, 0.7], [0.8, -0.5], [2.9, 0.9],
    ]) {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.4, 6), wood);
      branch.position.set(x, 1.1, 0.2);
      branch.rotation.x = a;
      g.add(branch);
    }
  } else if (kind === 'boulders') {
    const rock = std(0x84878b);
    for (const [x, s, z] of [
      [-2.8, 1.3, 0.2], [-0.9, 1.0, -0.3], [0.9, 1.5, 0.25], [2.8, 1.1, -0.15],
    ]) {
      const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rock);
      boulder.position.set(x, s * 0.55, z);
      boulder.rotation.y = x * 3.7;
      g.add(boulder);
    }
  } else if (kind === 'roadblock') {
    const stripes = std(0xd9534f, 0.6);
    const white = std(0xf2f0e8, 0.6);
    const legMat = std(0x3a3d42, 0.6);
    for (const px of [-3, 0, 3]) {
      for (const side of [-0.5, 0.5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), legMat);
        leg.position.set(px + side * 0.6, 0.6, side);
        leg.rotation.x = side * 0.7;
        g.add(leg);
      }
    }
    for (let i = 0; i < 8; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.3, 0.08), i % 2 ? white : stripes);
      plank.position.set(-3.7 + i * 1.05, 1.0, 0);
      g.add(plank);
    }
  } else {
    // junk pile: crates, tires, a sad mattress
    const crate = std(0x6e4b2a);
    for (const [x, y, z, ry] of [
      [-2.6, 0.45, 0, 0.3], [-1.5, 0.45, 0.3, -0.4], [-1.9, 1.3, 0.1, 0.9],
    ]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), crate);
      box.position.set(x, y, z);
      box.rotation.y = ry;
      g.add(box);
    }
    const tireMat = std(0x1c1d20, 0.7);
    for (const [x, y] of [
      [0.4, 0.35], [1.2, 0.35], [0.8, 1.0],
    ]) {
      const tire = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.16, 8, 14), tireMat);
      tire.position.set(x, y, 0.1);
      tire.rotation.x = Math.PI / 2 - 0.15;
      g.add(tire);
    }
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(2, 0.25, 1.1), std(0xb8ad93, 0.95));
    mattress.position.set(2.9, 0.3, -0.1);
    mattress.rotation.y = -0.25;
    g.add(mattress);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

function makeProgressBar(): { holder: THREE.Group; fill: THREE.Sprite } {
  const holder = new THREE.Group();
  holder.position.y = 3;
  const bg = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0x101018,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    }),
  );
  bg.scale.set(2.6, 0.45, 1);
  const fill = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xffb066,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }),
  );
  fill.scale.set(0.01, 0.3, 1);
  holder.add(bg, fill);
  holder.visible = false;
  return { holder, fill };
}

interface Entry {
  group: THREE.Group;
  bar: THREE.Group;
  fill: THREE.Sprite;
  ry: number;
  base: THREE.Vector3;
  clearAnim: number; // -1 = not started, 0..1 animating, >1 done
}

// Renders/animates road obstacles from network state and provides
// their collision AABBs while uncleared.
export class RoadObstacles {
  private entries = new Map<number, Entry>();

  constructor(private scene: THREE.Scene) {}

  sync(list: RoadObstacleState[]) {
    const seen = new Set<number>();
    for (const state of list) {
      seen.add(state.id);
      let entry = this.entries.get(state.id);
      if (!entry) {
        const y = elevation(state.p[0], state.p[2]);
        const group = buildMesh(state.kind);
        group.position.set(state.p[0], y, state.p[2]);
        group.rotation.y = state.ry;
        const { holder, fill } = makeProgressBar();
        group.add(holder);
        this.scene.add(group);
        entry = {
          group,
          bar: holder,
          fill,
          ry: state.ry,
          base: new THREE.Vector3(state.p[0], y, state.p[2]),
          clearAnim: state.cleared ? 2 : -1,
        };
        if (state.cleared) this.applyClearedPose(entry, 1);
        this.entries.set(state.id, entry);
      }
      entry.bar.visible = !state.cleared && state.progress > 0;
      const w = Math.max(0.01, 2.3 * state.progress);
      entry.fill.scale.set(w, 0.3, 1);
      entry.fill.position.x = 0;
      if (state.cleared && entry.clearAnim < 0) entry.clearAnim = 0;
      if (!state.cleared && entry.clearAnim >= 0) {
        // fresh run reset
        entry.clearAnim = -1;
        entry.group.position.copy(entry.base);
        entry.group.rotation.set(0, entry.ry, 0);
      }
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this.scene.remove(entry.group);
        this.entries.delete(id);
      }
    }
  }

  private applyClearedPose(entry: Entry, k: number) {
    // Shoved off along the road's width, tipping into the ditch
    const dx = Math.cos(entry.ry);
    const dz = -Math.sin(entry.ry);
    entry.group.position.set(
      entry.base.x + dx * 7.5 * k,
      entry.base.y - 0.35 * k,
      entry.base.z + dz * 7.5 * k,
    );
    entry.group.rotation.z = 0.35 * k;
  }

  update(dt: number) {
    for (const entry of this.entries.values()) {
      if (entry.clearAnim >= 0 && entry.clearAnim <= 1) {
        entry.clearAnim = Math.min(1.01, entry.clearAnim + dt / 1.2);
        const k = Math.min(1, entry.clearAnim);
        this.applyClearedPose(entry, k * (2 - k)); // ease-out
      }
    }
  }

  aabbs(list: RoadObstacleState[]): Obstacle[] {
    const out: Obstacle[] = [];
    for (const state of list) {
      if (state.cleared) continue;
      const cos = Math.abs(Math.cos(state.ry));
      const sin = Math.abs(Math.sin(state.ry));
      out.push({
        x: state.p[0],
        z: state.p[2],
        hx: cos * LONG_HALF + sin * SHORT_HALF,
        hz: sin * LONG_HALF + cos * SHORT_HALF,
      });
    }
    return out;
  }
}
