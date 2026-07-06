import * as THREE from 'three';
import type { Vec3 } from '../net/network';

let sharedGlow: THREE.Texture | null = null;

// Soft radial dot used by glows, steam, rain splashes and bursts.
export function glowTexture(): THREE.Texture {
  if (sharedGlow) return sharedGlow;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  sharedGlow = new THREE.CanvasTexture(canvas);
  return sharedGlow;
}

const RAIN_COUNT = 1000;

export class Rain {
  private points: THREE.Points;
  private positions: Float32Array;

  constructor(private scene: THREE.Scene) {
    this.positions = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.positions[i * 3] = -45 + Math.random() * 90;
      this.positions[i * 3 + 1] = Math.random() * 15;
      this.positions[i * 3 + 2] = -30 + Math.random() * 150;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x9aa7c9,
      size: 0.1,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      map: glowTexture(),
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number) {
    const p = this.positions;
    for (let i = 0; i < RAIN_COUNT; i++) {
      p[i * 3 + 1] -= 13 * dt;
      p[i * 3] += 1.2 * dt; // wind
      if (p[i * 3 + 1] < 0) {
        p[i * 3] = -45 + Math.random() * 90;
        p[i * 3 + 1] = 13 + Math.random() * 3;
        p[i * 3 + 2] = -30 + Math.random() * 150;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

interface SteamPuff {
  sprite: THREE.Sprite;
  life: number;
  max: number;
}

export class Steam {
  private puffs: SteamPuff[] = [];

  constructor(private scene: THREE.Scene, private origin: Vec3, count = 6) {
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: 0x8a8fa0,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      scene.add(sprite);
      this.puffs.push({ sprite, life: Math.random() * 3, max: 2.6 + Math.random() });
    }
  }

  update(dt: number) {
    for (const puff of this.puffs) {
      puff.life += dt;
      if (puff.life > puff.max) puff.life = 0;
      const k = puff.life / puff.max;
      puff.sprite.position.set(
        this.origin[0] + Math.sin(puff.life * 2) * 0.15,
        this.origin[1] + k * 2.6,
        this.origin[2],
      );
      const s = 0.5 + k * 1.6;
      puff.sprite.scale.set(s, s, 1);
      (puff.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(Math.PI * k) * 0.16;
    }
  }

  dispose() {
    for (const puff of this.puffs) {
      this.scene.remove(puff.sprite);
      puff.sprite.material.dispose();
    }
    this.puffs = [];
  }
}

interface Burst {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
}

interface ScorePop {
  sprite: THREE.Sprite;
  life: number;
}

function scoreSprite(points: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '900 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(`+${points}`, 64, 32);
  ctx.fillStyle = '#ffd166';
  ctx.fillText(`+${points}`, 64, 32);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
    }),
  );
  sprite.scale.set(1.3, 0.65, 1);
  return sprite;
}

// Little sparkle explosion + floating "+N" when a bottle gets grabbed.
export class PickupFX {
  private bursts: Burst[] = [];
  private pops: ScorePop[] = [];

  constructor(private scene: THREE.Scene) {}

  spawn(pos: Vec3, points: number, color: number) {
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      sprite.position.set(pos[0], 0.5, pos[2]);
      sprite.scale.set(0.35, 0.35, 1);
      this.scene.add(sprite);
      const angle = (i / 10) * Math.PI * 2;
      this.bursts.push({
        sprite,
        vel: new THREE.Vector3(Math.cos(angle) * 2.2, 2.5 + Math.random() * 1.5, Math.sin(angle) * 2.2),
        life: 0,
      });
    }
    const pop = scoreSprite(points);
    pop.position.set(pos[0], 1.2, pos[2]);
    this.scene.add(pop);
    this.pops.push({ sprite: pop, life: 0 });
  }

  update(dt: number) {
    this.bursts = this.bursts.filter((b) => {
      b.life += dt;
      if (b.life > 0.6) {
        this.scene.remove(b.sprite);
        b.sprite.material.dispose();
        return false;
      }
      b.vel.y -= 8 * dt;
      b.sprite.position.addScaledVector(b.vel, dt);
      (b.sprite.material as THREE.SpriteMaterial).opacity = 1 - b.life / 0.6;
      return true;
    });
    this.pops = this.pops.filter((p) => {
      p.life += dt;
      if (p.life > 1.1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        return false;
      }
      p.sprite.position.y += 1.2 * dt;
      (p.sprite.material as THREE.SpriteMaterial).opacity = 1 - (p.life / 1.1) ** 2;
      return true;
    });
  }
}
