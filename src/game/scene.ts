import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Vec3 } from '../net/network';
import { asphaltTextures, brickTexture, neonTexture } from './textures';

export interface Obstacle {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldGeom {
  obstacles: Obstacle[];
  bounds: Bounds;
  steamVents: Vec3[];
  updateFlicker(t: number): void;
}

const ALLEY_HALF_WIDTH = 8;
const ALLEY_HALF_LENGTH = 30;

export function buildScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer): WorldGeom {
  scene.background = new THREE.Color(0x07070d);
  scene.fog = new THREE.FogExp2(0x07070d, 0.024);

  // Subtle image-based lighting so materials get specular life
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0x3a3a55, 0x0a0a0f, 0.65));

  // Cold moonlight casting the scene's shadows
  const moon = new THREE.DirectionalLight(0x7484b8, 0.55);
  moon.position.set(14, 24, -18);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -12;
  moon.shadow.camera.right = 12;
  moon.shadow.camera.top = 34;
  moon.shadow.camera.bottom = -34;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 70;
  moon.shadow.bias = -0.0004;
  scene.add(moon);

  // Ground — cracked, stained asphalt
  const asphalt = asphaltTextures(4, 14);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ALLEY_HALF_WIDTH * 2, ALLEY_HALF_LENGTH * 2),
    new THREE.MeshStandardMaterial({
      map: asphalt.map,
      bumpMap: asphalt.bumpMap,
      bumpScale: 0.6,
      roughness: 0.92,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Rain puddles — near-mirror surfaces that catch the neon
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x232c40,
    roughness: 0.12,
    metalness: 0.55,
  });
  for (const [x, z, r] of [
    [-3, -12, 1.7],
    [4, 6, 1.3],
    [-2, 20, 2.0],
    [5, -22, 1.2],
    [1, -2, 1.5],
  ]) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(r, 24), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(x, 0.012, z);
    puddle.scale.x = 1.5;
    scene.add(puddle);
  }

  // Brick buildings
  const brickA = new THREE.MeshStandardMaterial({
    map: brickTexture(10, 2, 14, 26, 26),
    roughness: 0.95,
  });
  const brickB = new THREE.MeshStandardMaterial({
    map: brickTexture(10, 2, 250, 8, 22),
    roughness: 0.95,
  });
  const sideWallGeo = new THREE.BoxGeometry(1, 12, ALLEY_HALF_LENGTH * 2 + 2);
  const leftWall = new THREE.Mesh(sideWallGeo, brickA);
  leftWall.position.set(-(ALLEY_HALF_WIDTH + 0.5), 6, 0);
  const rightWall = new THREE.Mesh(sideWallGeo, brickB);
  rightWall.position.set(ALLEY_HALF_WIDTH + 0.5, 6, 0);
  const endWallGeo = new THREE.BoxGeometry(ALLEY_HALF_WIDTH * 2 + 2, 12, 1);
  const nearWall = new THREE.Mesh(endWallGeo, brickB);
  nearWall.position.set(0, 6, -(ALLEY_HALF_LENGTH + 0.5));
  const farWall = new THREE.Mesh(endWallGeo, brickA);
  farWall.position.set(0, 6, ALLEY_HALF_LENGTH + 0.5);
  for (const wall of [leftWall, rightWall, nearWall, farWall]) {
    wall.receiveShadow = true;
    scene.add(wall);
  }

  // Windows — some lit warm, most dark and dead
  const windowGeo = new THREE.BoxGeometry(0.12, 1.2, 0.9);
  const frameGeo = new THREE.BoxGeometry(0.14, 1.4, 1.1);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1712, roughness: 0.9 });
  for (let i = 0; i < 16; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const lit = Math.random() < 0.35;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d0d10,
      emissive: lit ? 0xcf9a4a : 0x11131c,
      emissiveIntensity: lit ? 0.9 : 0.25,
      roughness: 0.3,
      metalness: 0.4,
    });
    const x = side * (ALLEY_HALF_WIDTH - 0.02);
    const y = 3.6 + (i % 3) * 2.6;
    const z = -26 + i * 3.4;
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(x, y, z);
    const pane = new THREE.Mesh(windowGeo, mat);
    pane.position.set(side * (ALLEY_HALF_WIDTH - 0.0), y, z);
    scene.add(frame, pane);
  }

  const flickerItems: { obj: THREE.PointLight | THREE.MeshBasicMaterial; base: number; phase: number; neon: boolean }[] = [];

  // Neon signs (tone-mapping bypassed so bloom makes them scream)
  const addNeon = (
    text: string,
    cssColor: string,
    lightColor: number,
    x: number,
    z: number,
    facing: number,
  ) => {
    const mat = new THREE.MeshBasicMaterial({
      map: neonTexture(text, cssColor),
      transparent: true,
      side: THREE.DoubleSide,
    });
    mat.toneMapped = false;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.35), mat);
    sign.position.set(x, 4.9, z);
    sign.rotation.y = facing;
    scene.add(sign);
    const light = new THREE.PointLight(lightColor, 14, 14, 1.8);
    light.position.set(x + Math.sin(facing) * 0.8, 4.7, z);
    scene.add(light);
    flickerItems.push({ obj: mat, base: 1, phase: Math.random() * 100, neon: true });
    flickerItems.push({ obj: light, base: 14, phase: Math.random() * 100, neon: true });
  };
  addNeon('BAR', '#ff2d78', 0xff2d78, -(ALLEY_HALF_WIDTH - 0.05), -8, Math.PI / 2);
  addNeon('LIQUOR', '#2dffc8', 0x2dffc8, ALLEY_HALF_WIDTH - 0.05, 14, -Math.PI / 2);

  // Graffiti + torn posters on the walls
  const addDecal = (canvasDraw: (ctx: CanvasRenderingContext2D) => void, w: number, h: number, x: number, y: number, z: number, facing: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    canvasDraw(canvas.getContext('2d')!);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.9 }),
    );
    decal.position.set(x, y, z);
    decal.rotation.y = facing;
    scene.add(decal);
  };
  const spray = (text: string, color: string) => (ctx: CanvasRenderingContext2D) => {
    ctx.font = '900 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(128, 64);
    ctx.rotate(-0.08);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  addDecal(spray('CHEERS', '#c33fd4'), 3.4, 1.7, -(ALLEY_HALF_WIDTH - 0.04), 2.2, 8, Math.PI / 2);
  addDecal(spray('HIC!', '#4ad46a'), 2.4, 1.2, ALLEY_HALF_WIDTH - 0.04, 1.9, -16, -Math.PI / 2);
  addDecal(spray('ONE MORE', '#d4a53f'), 3.2, 1.6, ALLEY_HALF_WIDTH - 0.04, 2.4, 26, -Math.PI / 2);
  const poster = (base: string) => (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = base;
    ctx.fillRect(10, 6, 236, 116);
    ctx.fillStyle = 'rgba(240,235,220,0.9)';
    ctx.fillRect(22, 16, 212, 40);
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    for (let i = 0; i < 4; i++) ctx.fillRect(26, 66 + i * 13, 160 + Math.random() * 40, 6);
  };
  addDecal(poster('#7d2f2f'), 1.3, 0.9, -(ALLEY_HALF_WIDTH - 0.04), 2.6, -14, Math.PI / 2);
  addDecal(poster('#2f4d7d'), 1.2, 0.85, -(ALLEY_HALF_WIDTH - 0.04), 1.8, 17, Math.PI / 2);

  // Fire escape on the right wall
  const metal = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.6, metalness: 0.7 });
  const fe = new THREE.Group();
  for (let level = 0; level < 3; level++) {
    const y = 4 + level * 3;
    const platform = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 4.4), metal);
    platform.position.set(ALLEY_HALF_WIDTH - 0.7, y, -2);
    fe.add(platform);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 4.4), metal);
    rail.position.set(ALLEY_HALF_WIDTH - 1.32, y + 0.5, -2);
    fe.add(rail);
    const stairs = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.2, 1.1), metal);
    stairs.position.set(ALLEY_HALF_WIDTH - 0.7, y + 1.5, level % 2 === 0 ? 0.8 : -4.8);
    stairs.rotation.x = level % 2 === 0 ? 0.75 : -0.75;
    fe.add(stairs);
  }
  fe.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  scene.add(fe);

  // AC units dripping down the walls
  const acMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.5, metalness: 0.6 });
  for (const [side, y, z] of [
    [-1, 3.2, -22], [1, 4.4, 4], [-1, 5.0, 24],
  ]) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1), acMat);
    ac.position.set(side * (ALLEY_HALF_WIDTH - 0.35), y, z);
    ac.castShadow = true;
    scene.add(ac);
  }

  // Power cables sagging across the alley, with hanging bulbs
  for (const z of [-12, 10]) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-ALLEY_HALF_WIDTH, 7.6, z),
      new THREE.Vector3(0, 6.2, z + 0.6),
      new THREE.Vector3(ALLEY_HALF_WIDTH, 7.4, z),
    );
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 20, 0.025, 5),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.7 }),
    );
    scene.add(cable);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x332211,
        emissive: 0xffcf8a,
        emissiveIntensity: 2.2,
      }),
    );
    bulb.position.set(0, 6.15, z + 0.6);
    scene.add(bulb);
  }

  const obstacles: Obstacle[] = [];
  const addObstacle = (mesh: THREE.Object3D, x: number, z: number, hx: number, hz: number) => {
    mesh.position.x = x;
    mesh.position.z = z;
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(mesh);
    obstacles.push({ x, z, hx, hz });
  };

  // Dumpsters
  const dumpsterMat = new THREE.MeshStandardMaterial({ color: 0x2f4f33, roughness: 0.55, metalness: 0.45 });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x243c27, roughness: 0.55, metalness: 0.45 });
  const makeDumpster = (rotated: boolean) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.3), dumpsterMat);
    body.position.y = 0.78;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.35), lidMat);
    lid.position.set(0, 1.48, -0.1);
    lid.rotation.x = 0.28;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.42, 0.22, 1.32),
      new THREE.MeshStandardMaterial({ color: 0x171d18, roughness: 0.8 }),
    );
    stripe.position.y = 0.4;
    g.add(body, lid, stripe);
    for (const wx of [-0.9, 0.9]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.1, 10),
        new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.6 }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.12, 0.5);
      g.add(wheel);
    }
    if (rotated) g.rotation.y = Math.PI / 2;
    return g;
  };
  addObstacle(makeDumpster(false), -6.4, -18, 1.4, 0.9);
  addObstacle(makeDumpster(false), 6.3, -7, 1.4, 0.9);
  addObstacle(makeDumpster(true), -6.5, 4, 0.9, 1.4);
  addObstacle(makeDumpster(false), 6.4, 16, 1.4, 0.9);
  addObstacle(makeDumpster(true), -6.4, 25, 0.9, 1.4);

  // Wooden crates
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6e4b2a, roughness: 0.85 });
  const crateGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const makeCrates = () => {
    const g = new THREE.Group();
    const a = new THREE.Mesh(crateGeo, crateMat);
    a.position.y = 0.45;
    const b = new THREE.Mesh(crateGeo, crateMat);
    b.position.set(0.95, 0.45, 0.15);
    b.rotation.y = 0.4;
    const c = new THREE.Mesh(crateGeo, crateMat);
    c.position.set(0.4, 1.35, 0.05);
    c.rotation.y = -0.3;
    g.add(a, b, c);
    return g;
  };
  addObstacle(makeCrates(), 4.5, -24, 1.2, 0.9);
  addObstacle(makeCrates(), -4.8, 12, 1.2, 0.9);
  addObstacle(makeCrates(), 2.5, 27, 1.2, 0.9);

  // Trash bags (no collision — squishy)
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.35, metalness: 0.25 });
  for (const [x, z, s] of [
    [-5.5, -14, 1], [6.8, -20, 0.8], [-6.8, -2, 1.1], [6.5, 8, 0.9],
    [5.8, 22, 1], [-5.9, 18, 0.85], [-3, -27, 0.9], [1.5, -10, 0.7],
  ]) {
    const bag = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 * s, 0), bagMat);
    bag.position.set(x, 0.3 * s, z);
    bag.scale.y = 0.7;
    bag.rotation.y = x * 7.3;
    bag.castShadow = true;
    scene.add(bag);
  }

  // Scattered litter
  const litterGeo = new THREE.PlaneGeometry(0.28, 0.36);
  for (let i = 0; i < 22; i++) {
    const shade = 130 + Math.floor(Math.random() * 80);
    const litter = new THREE.Mesh(
      litterGeo,
      new THREE.MeshStandardMaterial({
        color: (shade << 16) | (shade << 8) | (shade - 20),
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    litter.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.3, 0, Math.random() * Math.PI);
    litter.position.set(-7 + Math.random() * 14, 0.02, -28 + Math.random() * 56);
    scene.add(litter);
  }

  // Flickering wall lamps with cone shades
  const lampShadeMat = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.5, metalness: 0.7 });
  for (const [x, z] of [
    [-7.6, -20], [7.6, -10], [-7.6, 2], [7.6, 12], [-7.6, 24],
  ]) {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.3, 12, 1, true), lampShadeMat);
    shade.position.set(x, 4.45, z);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffb066, emissiveIntensity: 2.6 }),
    );
    bulb.position.set(x, 4.28, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), lampShadeMat);
    arm.position.set(x + (x < 0 ? -0.35 : 0.35), 4.62, z);
    scene.add(shade, bulb, arm);
    const light = new THREE.PointLight(0xffb066, 34, 22, 1.8);
    light.position.set(x * 0.9, 4.1, z);
    scene.add(light);
    flickerItems.push({ obj: light, base: 34, phase: Math.random() * 100, neon: false });
  }

  const steamVents: Vec3[] = [
    [-6.2, 0.3, -10],
    [5.6, 0.3, 20],
  ];
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.7 });
  for (const v of steamVents) {
    const grate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), ventMat);
    grate.position.set(v[0], 0.06, v[2]);
    scene.add(grate);
  }

  const margin = 0.8;
  const bounds: Bounds = {
    minX: -(ALLEY_HALF_WIDTH - margin),
    maxX: ALLEY_HALF_WIDTH - margin,
    minZ: -(ALLEY_HALF_LENGTH - margin),
    maxZ: ALLEY_HALF_LENGTH - margin,
  };

  return {
    obstacles,
    bounds,
    steamVents,
    updateFlicker(t: number) {
      for (const item of flickerItems) {
        let k: number;
        if (item.neon) {
          // Neon buzz: mostly on, occasional dropouts
          const buzz = Math.sin(t * 19 + item.phase) * Math.sin(t * 2.3 + item.phase * 1.7);
          k = buzz < -0.88 ? 0.25 : 1;
        } else {
          const n =
            Math.sin(t * 11 + item.phase) * 0.5 +
            Math.sin(t * 23 + item.phase * 2) * 0.3 +
            Math.sin(t * 3.7 + item.phase) * 0.2;
          k = 0.82 + 0.18 * n;
        }
        if (item.obj instanceof THREE.PointLight) item.obj.intensity = item.base * k;
        else item.obj.opacity = k;
      }
    },
  };
}

export function randomFreePos(geom: WorldGeom): Vec3 {
  const { bounds, obstacles } = geom;
  for (let tries = 0; tries < 60; tries++) {
    const x = bounds.minX + 0.5 + Math.random() * (bounds.maxX - bounds.minX - 1);
    const z = bounds.minZ + 0.5 + Math.random() * (bounds.maxZ - bounds.minZ - 1);
    let clear = true;
    for (const o of obstacles) {
      if (Math.abs(x - o.x) < o.hx + 0.7 && Math.abs(z - o.z) < o.hz + 0.7) {
        clear = false;
        break;
      }
    }
    if (clear) return [x, 0, z];
  }
  return [0, 0, 0];
}
