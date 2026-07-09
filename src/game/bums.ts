import * as THREE from 'three';
import type { BumKind, BumState } from '../net/network';
import { glowTexture } from './fx';
import { elevation } from './road';
import type { Sound } from './sound';

// Client-side rendering of the host-simulated bums: scruffy drifter
// meshes with wiggling green stink puffs, walk/bang/flee animations,
// and the sound cues (door banging, "oof" on a hit, scream on flee).

const std = (color: number, roughness = 0.9) =>
  new THREE.MeshStandardMaterial({ color, roughness });

interface BumRig {
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  body: THREE.Group;
  // Loose cloth (rag flap, skirt) swung with the walk in update()
  cloth: THREE.Mesh[];
  stink: THREE.Sprite[];
  phase: number;
}

function buildBum(kind: BumKind): { group: THREE.Group; rig: BumRig } {
  const woman = kind === 'woman';
  const coat = std(woman ? 0x5d4a63 : 0x57503a);
  const rags = std(woman ? 0x7a5568 : 0x6b6248);
  const skin = std(0xc9a184); // long past a good wash
  const dark = std(0x22201c, 0.7);
  const hair = std(woman ? 0x6e6156 : 0x4a4038);

  const group = new THREE.Group();
  const body = new THREE.Group();

  const makeLeg = (side: 1 | -1) => {
    const leg = new THREE.Group();
    leg.position.set(0.13 * side, 0.85, 0);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.8, 7), dark);
    limb.position.y = -0.4;
    leg.add(limb);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.28), std(0x2c241c));
    foot.position.set(0, -0.82, 0.05);
    leg.add(foot);
    body.add(leg);
    return leg;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // Ragged coat torso; women get a long tattered skirt over the legs
  const cloth: THREE.Mesh[] = [];
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.75, 9), coat);
  torso.position.y = 1.2;
  body.add(torso);
  // Blotchy dirt smears on the coat
  const dirt = std(0x2e2a20, 0.98);
  for (let i = 0; i < 4; i++) {
    const smear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), dirt);
    const a = Math.random() * Math.PI * 2;
    smear.position.set(Math.sin(a) * 0.27, 0.95 + Math.random() * 0.5, Math.cos(a) * 0.27);
    smear.scale.set(1, 1.4, 0.3);
    smear.lookAt(smear.position.x * 2, smear.position.y, smear.position.z * 2);
    body.add(smear);
  }
  if (woman) {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.6, 9), rags);
    skirt.position.y = 0.62;
    body.add(skirt);
    cloth.push(skirt);
  }
  // Loose rag flaps
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.06), rags);
  flap.position.set(0, 0.92, 0.16);
  flap.rotation.x = 0.3;
  body.add(flap);
  cloth.push(flap);
  // A second tattered tail flapping behind
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.05), rags);
  tail.position.set(0.05, 0.85, -0.2);
  tail.rotation.x = -0.25;
  body.add(tail);
  cloth.push(tail);

  const makeArm = (side: 1 | -1) => {
    const arm = new THREE.Group();
    arm.position.set(0.3 * side, 1.5, 0);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.62, 7), coat);
    limb.position.y = -0.31;
    arm.add(limb);
    // Fingerless glove band above the bare hand
    const glove = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.1, 7), dirt);
    glove.position.y = -0.56;
    arm.add(glove);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), skin);
    hand.position.y = -0.64;
    arm.add(hand);
    // Reaching for that sweet RV door
    arm.rotation.x = -1.2;
    body.add(arm);
    return arm;
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);
  // Props: she hauls a stuffed shopping bag, he dangles a bottle on a
  // string — both hang off the left hand
  if (woman) {
    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.3, 0.16),
      std(0x7a8ba0, 0.9),
    );
    bag.position.set(0, -0.82, 0);
    armL.add(bag);
  } else {
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), dirt);
    string.position.set(0, -0.74, 0);
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.2, 7),
      std(0x3a5a2a, 0.4),
    );
    bottle.position.set(0, -0.9, 0);
    armL.add(string, bottle);
  }

  const head = new THREE.Group();
  head.position.y = 1.72;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), skin);
  skull.position.y = 0.18;
  head.add(skull);
  for (const side of [-1, 1] as const) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), dark);
    eye.position.set(0.08 * side, 0.22, 0.17);
    // Angry unibrow-ish scowl
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.02), dark);
    brow.position.set(0.085 * side, 0.27, 0.18);
    brow.rotation.z = -0.35 * side;
    head.add(eye, brow);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), std(0xb26a5a));
  nose.position.set(0, 0.16, 0.2);
  head.add(nose);
  if (woman) {
    // Headscarf knotted under the chin
    const scarf = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      std(0x8a3a3a),
    );
    scarf.position.y = 0.22;
    head.add(scarf);
  } else {
    // Wild hair and a scraggly beard
    const mop = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      hair,
    );
    mop.position.y = 0.26;
    mop.scale.set(1.05, 0.8, 1.05);
    const beard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.08), hair);
    beard.position.set(0, 0.02, 0.16);
    head.add(mop, beard);
  }
  body.add(head);

  // The stink itself: hazy sickly-green glow puffs rising off them —
  // additive sprites read as vapor and feed the bloom at night
  const stink: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0x86b83c,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    stink.push(puff);
    group.add(puff);
  }

  group.add(body);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  return {
    group,
    rig: { legL, legR, armL, armR, head, body, cloth, stink, phase: Math.random() * 10 },
  };
}

interface BumAvatar {
  group: THREE.Group;
  rig: BumRig;
  kind: BumKind;
  target: THREE.Vector3;
  targetRy: number;
  mode: BumState['mode'];
  hp: number;
  bangIn: number;
}

export class Bums {
  private map = new Map<number, BumAvatar>();

  constructor(
    private scene: THREE.Scene,
    private sound: Sound,
  ) {}

  // Reconcile with the host's bum list; fires the audio cues on
  // transitions (hp drop → oof, walk/bang → flee → scream).
  sync(states: BumState[]) {
    const seen = new Set<number>();
    for (const s of states) {
      seen.add(s.id);
      let bum = this.map.get(s.id);
      if (!bum) {
        const { group, rig } = buildBum(s.kind);
        group.position.set(s.p[0], elevation(s.p[0], s.p[2]), s.p[2]);
        group.rotation.y = s.ry;
        this.scene.add(group);
        bum = {
          group,
          rig,
          kind: s.kind,
          target: new THREE.Vector3(),
          targetRy: s.ry,
          mode: s.mode,
          hp: s.hp,
          bangIn: Math.random(),
        };
        this.map.set(s.id, bum);
      }
      if (s.hp < bum.hp) this.sound.playBumHit();
      if (s.mode === 'flee' && bum.mode !== 'flee') this.sound.playScream(s.kind);
      bum.hp = s.hp;
      bum.mode = s.mode;
      bum.target.set(s.p[0], elevation(s.p[0], s.p[2]), s.p[2]);
      bum.targetRy = s.ry;
    }
    for (const [id, bum] of this.map) {
      if (!seen.has(id)) {
        this.scene.remove(bum.group);
        this.map.delete(id);
      }
    }
  }

  update(dt: number, t: number) {
    const k = 1 - Math.pow(0.0001, dt);
    for (const bum of this.map.values()) {
      const g = bum.group;
      const r = bum.rig;
      const p = r.phase;
      g.position.lerp(bum.target, k);
      const delta = ((bum.targetRy - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      g.rotation.y += delta * k;

      if (bum.mode === 'bang') {
        // Hammering on the door with both fists
        const bang = Math.sin(t * 11 + p);
        r.armL.rotation.x = -1.6 + bang * 0.5;
        r.armR.rotation.x = -1.6 - bang * 0.5;
        r.legL.rotation.x = 0;
        r.legR.rotation.x = 0;
        r.body.rotation.x = 0.18;
        r.body.position.y = 0;
        r.head.rotation.z = Math.sin(t * 3 + p) * 0.15;
        bum.bangIn -= dt;
        if (bum.bangIn <= 0) {
          this.sound.playBang();
          bum.bangIn = 0.5 + Math.random() * 0.6;
        }
      } else if (bum.mode === 'block') {
        // Holding the road: feet planted, arms crossed-ish, shaking a
        // fist now and then — not going anywhere
        const sway = Math.sin(t * 1.6 + p);
        const shake = Math.max(0, Math.sin(t * 0.7 + p)) * Math.sin(t * 9 + p);
        r.legL.rotation.x = 0.12;
        r.legR.rotation.x = -0.12;
        r.armL.rotation.x = -1.5;
        r.armR.rotation.x = -1.9 + shake * 0.3;
        r.body.rotation.x = -0.05;
        r.body.position.y = 0;
        r.body.rotation.z = sway * 0.06;
        r.head.rotation.z = sway * 0.1;
      } else {
        const speed = bum.mode === 'flee' ? 16 : 7;
        const swing = Math.sin(t * speed + p);
        r.legL.rotation.x = swing * (bum.mode === 'flee' ? 0.9 : 0.5);
        r.legR.rotation.x = -swing * (bum.mode === 'flee' ? 0.9 : 0.5);
        if (bum.mode === 'flee') {
          // Arms straight up, flailing — full panic
          r.armL.rotation.x = Math.PI - 0.3 + swing * 0.25;
          r.armR.rotation.x = Math.PI - 0.3 - swing * 0.25;
          r.body.rotation.x = 0.25;
          r.body.position.y = Math.abs(Math.cos(t * speed + p)) * 0.09;
          r.head.rotation.z = swing * 0.2;
        } else {
          // Zombie shamble, arms out for the vehicle
          r.armL.rotation.x = -1.2 + swing * 0.15;
          r.armR.rotation.x = -1.2 - swing * 0.15;
          r.body.rotation.x = 0.1;
          r.body.position.y = Math.abs(Math.cos(t * speed + p)) * 0.04;
          r.head.rotation.z = Math.sin(t * 1.9 + p) * 0.12;
        }
      }

      // Loose cloth swings with the gait (walk) or the panic (flee)
      const clothSwing =
        bum.mode === 'bang'
          ? Math.sin(t * 11 + p) * 0.12
          : Math.sin(t * (bum.mode === 'flee' ? 16 : 7) + p) *
            (bum.mode === 'flee' ? 0.45 : 0.22);
      for (let i = 0; i < r.cloth.length; i++) {
        const base = i === 0 && bum.kind === 'woman' ? 0 : i === r.cloth.length - 1 ? -0.25 : 0.3;
        r.cloth[i].rotation.x = base + clothSwing * (i % 2 === 0 ? 1 : -0.7);
        r.cloth[i].rotation.z = clothSwing * 0.4;
      }

      // Stink puffs spiral up and fade on repeat
      for (let i = 0; i < r.stink.length; i++) {
        const cycle = (t * 0.6 + p + i * 0.33) % 1;
        const puff = r.stink[i];
        puff.position.set(
          Math.sin((t + i * 2.1 + p) * 3) * 0.18,
          1.95 + cycle * 0.85,
          Math.cos((t + i * 1.7 + p) * 2.6) * 0.18,
        );
        puff.scale.setScalar(0.45 + cycle * 0.55);
        puff.material.opacity = 0.42 * (1 - cycle * 0.8);
      }
    }
  }

  get count(): number {
    return this.map.size;
  }
}
