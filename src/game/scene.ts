import * as THREE from 'three';
import type { Vec3 } from '../net/network';

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
  updateFlicker(t: number): void;
}

const ALLEY_HALF_WIDTH = 8;
const ALLEY_HALF_LENGTH = 30;

export function buildScene(scene: THREE.Scene): WorldGeom {
  scene.background = new THREE.Color(0x07070d);
  scene.fog = new THREE.FogExp2(0x07070d, 0.026);

  scene.add(new THREE.HemisphereLight(0x3a3a55, 0x0a0a0f, 0.55));

  // Ground — cracked asphalt
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ALLEY_HALF_WIDTH * 2, ALLEY_HALF_LENGTH * 2),
    new THREE.MeshStandardMaterial({ color: 0x232329, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Puddles
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x0e1018,
    roughness: 0.15,
    metalness: 0.7,
  });
  for (const [x, z, r] of [
    [-3, -12, 1.6],
    [4, 6, 1.2],
    [-2, 20, 1.9],
    [5, -22, 1.1],
  ]) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(r, 20), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(x, 0.01, z);
    puddle.scale.x = 1.4;
    scene.add(puddle);
  }

  // Building walls
  const wallMatA = new THREE.MeshStandardMaterial({ color: 0x3a2f2a, roughness: 0.9 });
  const wallMatB = new THREE.MeshStandardMaterial({ color: 0x2e2c38, roughness: 0.9 });
  const sideWallGeo = new THREE.BoxGeometry(1, 12, ALLEY_HALF_LENGTH * 2 + 2);
  const leftWall = new THREE.Mesh(sideWallGeo, wallMatA);
  leftWall.position.set(-(ALLEY_HALF_WIDTH + 0.5), 6, 0);
  const rightWall = new THREE.Mesh(sideWallGeo, wallMatB);
  rightWall.position.set(ALLEY_HALF_WIDTH + 0.5, 6, 0);
  const endWallGeo = new THREE.BoxGeometry(ALLEY_HALF_WIDTH * 2 + 2, 12, 1);
  const nearWall = new THREE.Mesh(endWallGeo, wallMatB);
  nearWall.position.set(0, 6, -(ALLEY_HALF_LENGTH + 0.5));
  const farWall = new THREE.Mesh(endWallGeo, wallMatA);
  farWall.position.set(0, 6, ALLEY_HALF_LENGTH + 0.5);
  scene.add(leftWall, rightWall, nearWall, farWall);

  // Dim windows on the walls
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a10,
    emissive: 0x5a4a1a,
    emissiveIntensity: 0.6,
    roughness: 0.4,
  });
  const windowGeo = new THREE.BoxGeometry(0.1, 1.2, 0.9);
  for (let i = 0; i < 10; i++) {
    const w = new THREE.Mesh(windowGeo, windowMat);
    const side = i % 2 === 0 ? -1 : 1;
    w.position.set(
      side * (ALLEY_HALF_WIDTH - 0.05),
      3.5 + (i % 3) * 2.4,
      -24 + i * 5.3,
    );
    scene.add(w);
  }

  const obstacles: Obstacle[] = [];
  const addObstacle = (mesh: THREE.Object3D, x: number, z: number, hx: number, hz: number) => {
    mesh.position.x = x;
    mesh.position.z = z;
    scene.add(mesh);
    obstacles.push({ x, z, hx, hz });
  };

  // Dumpsters
  const dumpsterMat = new THREE.MeshStandardMaterial({ color: 0x2f4f33, roughness: 0.7, metalness: 0.3 });
  const lidMat = new THREE.MeshStandardMaterial({ color: 0x263f29, roughness: 0.7, metalness: 0.3 });
  const makeDumpster = (rotated: boolean) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.3), dumpsterMat);
    body.position.y = 0.75;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.35), lidMat);
    lid.position.set(0, 1.45, -0.1);
    lid.rotation.x = 0.28;
    g.add(body, lid);
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
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.5, metalness: 0.2 });
  for (const [x, z, s] of [
    [-5.5, -14, 1], [6.8, -20, 0.8], [-6.8, -2, 1.1], [6.5, 8, 0.9],
    [5.8, 22, 1], [-5.9, 18, 0.85], [-3, -27, 0.9], [1.5, -10, 0.7],
  ]) {
    const bag = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 * s, 0), bagMat);
    bag.position.set(x, 0.3 * s, z);
    bag.scale.y = 0.7;
    bag.rotation.y = x * 7.3;
    scene.add(bag);
  }

  // Flickering wall lamps
  const lights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x332211,
    emissive: 0xffb066,
    emissiveIntensity: 1.5,
  });
  for (const [x, z] of [
    [-7.6, -20], [7.6, -10], [-7.6, 2], [7.6, 12], [-7.6, 24],
  ]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat);
    lamp.position.set(x, 4.2, z);
    scene.add(lamp);
    const light = new THREE.PointLight(0xffb066, 30, 22, 1.8);
    light.position.set(x * 0.92, 4.2, z);
    scene.add(light);
    lights.push({ light, base: 30, phase: Math.random() * 100 });
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
    updateFlicker(t: number) {
      for (const { light, base, phase } of lights) {
        const n =
          Math.sin(t * 11 + phase) * 0.5 +
          Math.sin(t * 23 + phase * 2) * 0.3 +
          Math.sin(t * 3.7 + phase) * 0.2;
        light.intensity = base * (0.82 + 0.18 * n);
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
