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
  } else if (kind === 'carcass') {
    // Dead animals strewn across the lane — a moose on its side and a
    // couple of boars, legs stiff in the air, crows' feast
    const hide = std(0x5a4632, 0.95);
    const boarHide = std(0x3e3630, 0.95);
    const moose = new THREE.Group();
    const mooseBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.7, 4, 10), hide);
    mooseBody.rotation.z = Math.PI / 2;
    mooseBody.position.y = 0.55;
    const mooseHead = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.4, 0.7), hide);
    mooseHead.position.set(-1.6, 0.4, 0.2);
    mooseHead.rotation.y = 0.5;
    const antler = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.35), std(0xc9b896, 0.8));
    antler.position.set(-1.85, 0.62, 0.35);
    antler.rotation.z = 0.4;
    moose.add(mooseBody, mooseHead, antler);
    const legGeo = new THREE.CylinderGeometry(0.07, 0.05, 0.9, 6);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(legGeo, hide);
      leg.position.set(-0.6 + (i % 2) * 0.5, 0.9, 0.35 + Math.floor(i / 2) * 0.25);
      leg.rotation.x = -0.9 - (i % 2) * 0.25;
      moose.add(leg);
    }
    moose.position.x = -1.4;
    g.add(moose);
    for (const [bx, bry] of [
      [1.6, 0.6],
      [3.1, -0.8],
    ] as const) {
      const boar = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.8, 4, 8), boarHide);
      body.rotation.z = Math.PI / 2;
      body.position.y = 0.32;
      const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.25, 6), boarHide);
      snout.rotation.z = Math.PI / 2;
      snout.position.set(-0.72, 0.3, 0);
      boar.add(body, snout);
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.5, 5), boarHide);
        leg.position.set(-0.25 + (i % 2) * 0.4, 0.55, 0.18 + Math.floor(i / 2) * 0.14);
        leg.rotation.x = -1.1;
        boar.add(leg);
      }
      boar.position.set(bx, 0, 0);
      boar.rotation.y = bry;
      g.add(boar);
    }
    // Crows picking at the feast
    const crowMat = std(0x16181c, 0.7);
    for (const [cx, cz] of [
      [-0.4, 0.7],
      [2.3, -0.5],
    ] as const) {
      const crow = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.14, 4, 6), crowMat);
      body.rotation.x = 1.2;
      body.position.y = 0.14;
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 5), std(0xc9a13a, 0.6));
      beak.rotation.x = Math.PI / 2 + 0.5;
      beak.position.set(0, 0.22, 0.14);
      crow.add(body, beak);
      crow.position.set(cx, 0.5, cz);
      g.add(crow);
    }
  } else if (kind === 'bridge') {
    // The river crossing. 'unbuilt': a plank pile and posts by a rope
    // barrier. 'built' (revealed on cleared): a proper deck spanning
    // the water. RoadObstacles toggles the two named groups.
    const plank = std(0x8a6a3e, 0.85);
    const darkWood = std(0x5e4527, 0.9);
    const unbuilt = new THREE.Group();
    unbuilt.name = 'unbuilt';
    for (let i = 0; i < 5; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.45), plank);
      board.position.set(-2.6, 0.15 + i * 0.13, -0.2 + (i % 2) * 0.3);
      board.rotation.y = (i % 2 ? 1 : -1) * 0.18;
      unbuilt.add(board);
    }
    // rope barrier on posts across the lane
    for (const px of [-3.6, 0, 3.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.1, 6), darkWood);
      post.position.set(px, 0.55, 0);
      unbuilt.add(post);
    }
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 7.6, 5), std(0xb8a878, 0.9));
    rope.rotation.z = Math.PI / 2;
    rope.position.y = 0.95;
    unbuilt.add(rope);
    const built = new THREE.Group();
    built.name = 'built';
    built.visible = false;
    // Deck of cross planks over two beams, low side rails
    for (const bz of [-1.1, 1.1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.22, 0.3), darkWood);
      beam.position.set(0, 0.25, bz);
      built.add(beam);
    }
    for (let i = 0; i < 12; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.1, 2.9), plank);
      board.position.set(-4.35 + i * 0.79, 0.41, 0);
      board.rotation.y = (Math.random() - 0.5) * 0.05;
      built.add(board);
    }
    for (const bz of [-1.42, 1.42]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.09, 0.09), darkWood);
      rail.position.set(0, 1.0, bz);
      built.add(rail);
      for (const px of [-4.2, -1.4, 1.4, 4.2]) {
        const baluster = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.65, 0.09), darkWood);
        baluster.position.set(px, 0.7, bz);
        built.add(baluster);
      }
    }
    g.add(unbuilt, built);
  } else if (kind === 'bumcamp') {
    // A bum encampment squatting on the road: barrel fire, shopping
    // cart, bedrolls, bottle stash. The bums themselves are host-
    // simulated BumStates whacked away with sticks.
    const rust = std(0x6b4a30, 0.8);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 10), rust);
    barrel.position.set(-0.4, 0.48, 0);
    g.add(barrel);
    // fire glow poking out of the barrel
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.55, 7),
      new THREE.MeshStandardMaterial({
        color: 0xff8c2e,
        emissive: 0xff6a1a,
        emissiveIntensity: 1.6,
        roughness: 0.7,
      }),
    );
    fire.position.set(-0.4, 1.15, 0);
    g.add(fire);
    // shopping cart: box on cylinders
    const cartMat = std(0x9aa0a8, 0.4);
    const cart = new THREE.Group();
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.55), cartMat);
    basket.position.y = 0.75;
    cart.add(basket);
    for (const [wx, wz] of [
      [-0.3, -0.2],
      [0.3, -0.2],
      [-0.3, 0.2],
      [0.3, 0.2],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 8), std(0x2a2c30, 0.5));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.1, wz);
      cart.add(wheel);
    }
    cart.position.set(2.6, 0, 0.2);
    cart.rotation.y = 0.7;
    g.add(cart);
    // bedrolls + bottles
    for (const [bx, bz, bry] of [
      [-2.9, 0.3, 0.4],
      [1.2, -0.4, -0.7],
    ] as const) {
      const roll = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), std(0x55504a, 0.95));
      roll.rotation.z = Math.PI / 2;
      roll.rotation.y = bry;
      roll.position.set(bx, 0.2, bz);
      g.add(roll);
    }
    const bottleMat = std(0x3a5a2a, 0.3);
    for (let i = 0; i < 5; i++) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 6), bottleMat);
      const a = i * 1.3;
      bottle.position.set(-0.4 + Math.sin(a) * 0.9, 0.14, Math.cos(a) * 0.7);
      bottle.rotation.x = (i % 2) * (Math.PI / 2 - 0.2);
      g.add(bottle);
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
  kind: RoadObstacleKind;
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
          kind: state.kind,
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
        this.setBridgeBuilt(entry, false);
      }
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this.scene.remove(entry.group);
        this.entries.delete(id);
      }
    }
  }

  private setBridgeBuilt(entry: Entry, built: boolean) {
    if (entry.kind !== 'bridge') return;
    for (const child of entry.group.children) {
      if (child.name === 'built') child.visible = built;
      if (child.name === 'unbuilt') child.visible = !built;
    }
  }

  private applyClearedPose(entry: Entry, k: number) {
    if (entry.kind === 'bridge') {
      // Building, not clearing: the finished deck rises into place
      this.setBridgeBuilt(entry, true);
      entry.group.position.set(entry.base.x, entry.base.y - 0.4 * (1 - k), entry.base.z);
      return;
    }
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
