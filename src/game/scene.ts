import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SceneMode, Vec3 } from '../net/network';
import {
  ASPHALT_END_T,
  FINISH,
  GATE_Z,
  ROAD_HALF_WIDTH,
  distanceToRoad,
  elevation,
  roadCurve,
  sampleRoad,
} from './road';
import {
  asphaltTextures,
  brickTexture,
  celestialTexture,
  cloudTexture,
  facadeTexture,
  grassTexture,
  neonTexture,
  sandTextures,
  signTexture,
  skyTexture,
} from './textures';

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
  mode: SceneMode;
  obstacles: Obstacle[];
  bounds: Bounds;
  steamVents: Vec3[];
  updateFlicker(t: number): void;
  // Keep the (small) shadow frustum centered on the local player —
  // the world is far too long to cover with one static shadow map.
  focusShadow(x: number, z: number): void;
  dispose(): void;
}

const ALLEY_HALF_WIDTH = 8;
const ALLEY_HALF_LENGTH = 30;

// The alley opens at +z onto a small drivable city: a 2x2 grid of
// building blocks separated by streets, ringed by a perimeter wall.
const CITY_HALF_WIDTH = 45;
const CITY_MAX_Z = 120;
// Block centers/half-sizes (also their collision AABBs)
const CITY_BLOCKS: { x: number; z: number; h: number }[] = [
  { x: -20, z: 54.5, h: 11 },
  { x: 20, z: 54.5, h: 14 },
  { x: -20, z: 95.5, h: 13 },
  { x: 20, z: 95.5, h: 10 },
];
const BLOCK_HALF = 14;

// Past the city gate: countryside with the winding road to ROUTE 65.
const WORLD_HALF_WIDTH = 60;
const WORLD_MAX_Z = 458;

// Builds the whole alley for one time-of-day into a disposable group,
// so the host's day/night choice can swap the environment live while
// players, bottles and FX (added directly to the scene) survive.
export function buildScene(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  mode: SceneMode,
): WorldGeom {
  const night = mode === 'night';
  const root = new THREE.Group();
  scene.add(root);

  scene.background = new THREE.Color(night ? 0x07070d : 0x9fb6d8);
  scene.fog = night
    ? new THREE.FogExp2(0x07070d, 0.019)
    : new THREE.FogExp2(0xa8b8cc, 0.007);

  // ——— Sky: gradient dome + sun/clouds (day) or stars/moon (night) ———
  const SKY_CENTER = new THREE.Vector3(0, 0, 200);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(560, 24, 12),
    new THREE.MeshBasicMaterial({
      map: night
        ? skyTexture([
            [0, '#02020a'],
            [0.45, '#0a0c1e'],
            [0.62, '#141830'],
            [1, '#1c1f38'],
          ])
        : skyTexture([
            [0, '#3f6fb5'],
            [0.42, '#7fa3d4'],
            [0.58, '#b8cbe4'],
            [1, '#d8e0ea'],
          ]),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  dome.position.copy(SKY_CENTER);
  dome.renderOrder = -10;
  root.add(dome);

  const celestial = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: night
        ? celestialTexture('rgba(228,232,244,1)', 'rgba(150,165,210,0.35)')
        : celestialTexture('rgba(255,246,214,1)', 'rgba(255,214,140,0.45)'),
      transparent: true,
      fog: false,
      depthWrite: false,
    }),
  );
  celestial.material.toneMapped = false;
  // Along the directional light's bearing, high on the dome
  celestial.position
    .set(night ? 130 : -150, 260, night ? -160 : 90)
    .add(SKY_CENTER.clone().multiplyScalar(0.5));
  celestial.scale.setScalar(night ? 42 : 60);
  root.add(celestial);

  const cloudDrift: THREE.Sprite[] = [];
  {
    // Clouds both day and night (dim and moonlit after dark)
    const cloudMap = cloudTexture();
    const count = night ? 10 : 22;
    for (let i = 0; i < count; i++) {
      const cloud = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: cloudMap,
          color: night ? 0x50597a : 0xffffff,
          transparent: true,
          opacity: night ? 0.3 : 0.6 + Math.random() * 0.3,
          fog: false,
          depthWrite: false,
        }),
      );
      cloud.position.set(
        -240 + Math.random() * 480,
        60 + Math.random() * 70,
        -60 + Math.random() * 500,
      );
      const s = 70 + Math.random() * 90;
      cloud.scale.set(s, s * 0.42, 1);
      cloud.renderOrder = -8;
      root.add(cloud);
      cloudDrift.push(cloud);
    }
  }
  if (night) {
    // Starfield on the upper dome
    const starPositions: number[] = [];
    for (let i = 0; i < 550; i++) {
      const az = Math.random() * Math.PI * 2;
      const alt = 0.12 + Math.random() * (Math.PI / 2 - 0.14);
      const r = 520;
      starPositions.push(
        SKY_CENTER.x + r * Math.cos(alt) * Math.cos(az),
        r * Math.sin(alt),
        SKY_CENTER.z + r * Math.cos(alt) * Math.sin(az),
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xdde4f4,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.85,
        fog: false,
        depthWrite: false,
      }),
    );
    stars.renderOrder = -9;
    root.add(stars);
  }

  // Subtle image-based lighting so materials get specular life
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = night ? 0.3 : 0.55;
  pmrem.dispose();

  root.add(
    night
      ? new THREE.HemisphereLight(0x3a3a55, 0x0a0a0f, 0.65)
      : new THREE.HemisphereLight(0xcfe0ff, 0x5c584a, 1.0),
  );

  // Night: cold moonlight. Day: Baltic afternoon sun.
  const sun = night
    ? new THREE.DirectionalLight(0x7484b8, 0.55)
    : new THREE.DirectionalLight(0xfff0d0, 2.0);
  sun.position.set(night ? 14 : -16, night ? 26 : 30, (night ? -18 : -12) + 45);
  sun.target.position.set(0, 0, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 85;
  sun.shadow.camera.bottom = -85;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  root.add(sun, sun.target);

  // Ground — cracked, stained asphalt covering alley + city
  const asphalt = asphaltTextures(6, 10);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF_WIDTH * 2 + 2, CITY_MAX_Z + ALLEY_HALF_LENGTH + 2),
    new THREE.MeshStandardMaterial({
      map: asphalt.map,
      bumpMap: asphalt.bumpMap,
      bumpScale: 0.6,
      roughness: 0.92,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, (CITY_MAX_Z - ALLEY_HALF_LENGTH) / 2);
  ground.receiveShadow = true;
  root.add(ground);

  // Rain puddles — catch the neon at night, the sky by day
  const puddleMat = new THREE.MeshStandardMaterial({
    color: night ? 0x232c40 : 0x8095b3,
    roughness: night ? 0.12 : 0.08,
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
    root.add(puddle);
  }

  const obstacles: Obstacle[] = [];

  // Brick for the alley's inner faces — Vilnius old-town ochre and rose
  const brickA = new THREE.MeshStandardMaterial({
    map: brickTexture(10, 2, 30, 34, night ? 30 : 42),
    roughness: 0.95,
  });
  const brickB = new THREE.MeshStandardMaterial({
    map: brickTexture(10, 2, 4, 22, night ? 26 : 38),
    roughness: 0.95,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x23211e, roughness: 0.95 });
  const litProb = night ? 0.3 : 0;

  // Two massive buildings flank the alley (their inner faces are the
  // alley walls); the far end between them is open — the way out to
  // the city.
  const fillerW = CITY_HALF_WIDTH - ALLEY_HALF_WIDTH; // 37
  const fillerGeo = new THREE.BoxGeometry(fillerW, 12, ALLEY_HALF_LENGTH * 2 + 1);
  for (const side of [-1, 1] as const) {
    const facade = new THREE.MeshStandardMaterial({
      map: facadeTexture(side < 0 ? 36 : 8, 30, night ? 30 : 44, litProb),
      roughness: 0.9,
    });
    facade.map!.repeat.set(2, 1);
    // px, nx, py, ny, pz, nz — inner alley face gets brick
    const mats =
      side < 0
        ? [brickA, facade, roofMat, roofMat, facade, facade]
        : [facade, brickB, roofMat, roofMat, facade, facade];
    const filler = new THREE.Mesh(fillerGeo, mats);
    const cx = side * (ALLEY_HALF_WIDTH + fillerW / 2);
    filler.position.set(cx, 6, 0);
    filler.receiveShadow = true;
    filler.castShadow = true;
    root.add(filler);
    obstacles.push({ x: cx, z: 0, hx: fillerW / 2, hz: ALLEY_HALF_LENGTH + 0.5 });
  }

  // Closed alley end (basketball wall)
  const nearWall = new THREE.Mesh(
    new THREE.BoxGeometry(ALLEY_HALF_WIDTH * 2 + 2, 12, 1),
    brickB,
  );
  nearWall.position.set(0, 6, -(ALLEY_HALF_LENGTH + 0.5));
  nearWall.receiveShadow = true;
  root.add(nearWall);

  // City blocks — one building per block, Vilnius pastel facades
  const blockHues = [36, 205, 10, 48];
  CITY_BLOCKS.forEach((block, i) => {
    const facade = new THREE.MeshStandardMaterial({
      map: facadeTexture(blockHues[i], i === 1 ? 10 : 32, night ? 32 : 48, litProb),
      roughness: 0.9,
    });
    facade.map!.repeat.set(2, 1);
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(BLOCK_HALF * 2, block.h, BLOCK_HALF * 2),
      [facade, facade, roofMat, roofMat, facade, facade],
    );
    building.position.set(block.x, block.h / 2, block.z);
    building.castShadow = true;
    building.receiveShadow = true;
    root.add(building);
    obstacles.push({ x: block.x, z: block.z, hx: BLOCK_HALF, hz: BLOCK_HALF });
  });

  // A little white bell tower on one roof — labas, Vilnius
  const towerBlock = CITY_BLOCKS[3];
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.9, 5, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.85 }),
  );
  tower.position.set(towerBlock.x + 8, towerBlock.h + 2.5, towerBlock.z + 8);
  const towerRoof = new THREE.Mesh(
    new THREE.ConeGeometry(1.9, 2.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.7 }),
  );
  towerRoof.position.set(towerBlock.x + 8, towerBlock.h + 6.1, towerBlock.z + 8);
  tower.castShadow = true;
  root.add(tower, towerRoof);

  // Perimeter wall around the city — now real obstacles, since the
  // world bounds extend past them into the countryside. The north wall
  // splits in two, leaving the gate where the road begins.
  const perimMat = new THREE.MeshStandardMaterial({ color: 0x565a5e, roughness: 0.95 });
  const sideLen = CITY_MAX_Z - ALLEY_HALF_LENGTH + 1;
  for (const side of [-1, 1] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, sideLen), perimMat);
    wall.position.set(side * (CITY_HALF_WIDTH + 0.6), 1.5, (CITY_MAX_Z + ALLEY_HALF_LENGTH) / 2);
    wall.receiveShadow = true;
    root.add(wall);
    obstacles.push({
      x: side * (CITY_HALF_WIDTH + 0.6),
      z: (CITY_MAX_Z + ALLEY_HALF_LENGTH) / 2,
      hx: 0.7,
      hz: sideLen / 2,
    });
    // Dead strip between the city wall and the world edge, south of
    // the countryside — block it off invisibly.
    obstacles.push({
      x: side * ((CITY_HALF_WIDTH + WORLD_HALF_WIDTH) / 2 + 1),
      z: (GATE_Z - ALLEY_HALF_LENGTH) / 2,
      hx: (WORLD_HALF_WIDTH - CITY_HALF_WIDTH) / 2 + 1,
      hz: (GATE_Z + ALLEY_HALF_LENGTH) / 2,
    });
  }
  const GATE_HALF = 7;
  for (const side of [-1, 1] as const) {
    const segW = CITY_HALF_WIDTH - GATE_HALF + 1.2;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(segW, 3, 1.2), perimMat);
    const cx = side * (GATE_HALF + segW / 2);
    seg.position.set(cx, 1.5, CITY_MAX_Z + 0.6);
    seg.receiveShadow = true;
    root.add(seg);
    obstacles.push({ x: cx, z: CITY_MAX_Z + 0.6, hx: segW / 2, hz: 0.7 });
  }

  // ——— The countryside: grass, the winding road, ROUTE 65 ———————————

  // Grass heightfield: the countryside rolls with the hills
  const grassGeo = new THREE.PlaneGeometry(
    WORLD_HALF_WIDTH * 2,
    WORLD_MAX_Z - GATE_Z + 10,
    64,
    180,
  );
  grassGeo.rotateX(-Math.PI / 2);
  grassGeo.translate(0, 0, (GATE_Z - 4 + WORLD_MAX_Z + 6) / 2);
  {
    const positions = grassGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const gx = positions.getX(i);
      const gz = positions.getZ(i);
      // Tuck the (coarser) grass under the road bed so it can't poke
      // through the ribbon between heightfield vertices
      const d = distanceToRoad(gx, gz);
      const dip = Math.max(0, 1 - d / (ROAD_HALF_WIDTH + 1.5)) * 0.45;
      positions.setY(i, elevation(gx, gz) + 0.004 - dip);
    }
    grassGeo.computeVertexNormals();
  }
  const grass = new THREE.Mesh(
    grassGeo,
    new THREE.MeshStandardMaterial({ map: grassTexture(12, 34), roughness: 0.95 }),
  );
  grass.receiveShadow = true;
  root.add(grass);

  // Road ribbon along the curve; asphalt near town, sand further out
  const buildRibbon = (
    t0: number,
    t1: number,
    material: THREE.MeshStandardMaterial,
  ) => {
    const segs = Math.max(8, Math.round((t1 - t0) * 170));
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = t0 + ((t1 - t0) * i) / segs;
      const p = roadCurve.getPointAt(t);
      const tan = roadCurve.getTangentAt(t);
      const nx = tan.z;
      const nz = -tan.x;
      const y = elevation(p.x, p.z) + 0.06;
      positions.push(
        p.x + nx * ROAD_HALF_WIDTH, y, p.z + nz * ROAD_HALF_WIDTH,
        p.x - nx * ROAD_HALF_WIDTH, y, p.z - nz * ROAD_HALF_WIDTH,
      );
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, t * 40, 1, t * 40);
      if (i < segs) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    root.add(mesh);
  };
  const roadAsphalt = asphaltTextures(1, 1);
  buildRibbon(
    0,
    ASPHALT_END_T + 0.005,
    new THREE.MeshStandardMaterial({
      map: roadAsphalt.map,
      bumpMap: roadAsphalt.bumpMap,
      bumpScale: 0.5,
      roughness: 0.92,
      side: THREE.DoubleSide,
    }),
  );
  const roadSand = sandTextures(1, 1);
  buildRibbon(
    ASPHALT_END_T - 0.005,
    1,
    new THREE.MeshStandardMaterial({
      map: roadSand.map,
      bumpMap: roadSand.bumpMap,
      bumpScale: 0.5,
      roughness: 0.95,
      side: THREE.DoubleSide,
    }),
  );

  // Pines, bushes and rocks (merged for draw calls), all planted on
  // the terrain. addPine writes into the shared geometry arrays.
  const trunkGeos: THREE.BufferGeometry[] = [];
  const leafGeos: THREE.BufferGeometry[] = [];
  const bushGeos: THREE.BufferGeometry[] = [];
  const rockGeos: THREE.BufferGeometry[] = [];
  const addPine = (x: number, z: number, s: number) => {
    const y = elevation(x, z);
    const trunk = new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 1.4 * s, 6);
    trunk.translate(x, y + 0.7 * s, z);
    trunkGeos.push(trunk);
    const lower = new THREE.ConeGeometry(1.5 * s, 2.6 * s, 7);
    lower.translate(x, y + 2.4 * s, z);
    const upper = new THREE.ConeGeometry(1.05 * s, 2.0 * s, 7);
    upper.translate(x, y + 3.7 * s, z);
    leafGeos.push(lower, upper);
  };

  // The forest wall: dense pine belts flanking the road corridor, so
  // the collision rail (clampToRoadCorridor) reads as scenery.
  for (let t = 0.005; t <= 0.985; t += 0.006) {
    const s = sampleRoad(t);
    for (const side of [-1, 1] as const) {
      const jitterAlong = (Math.random() - 0.5) * 2.5;
      const off = ROAD_HALF_WIDTH + 3.6 + Math.random() * 2.2;
      const x = s.p[0] + Math.cos(s.angle) * off * side + Math.sin(s.angle) * jitterAlong;
      const z = s.p[2] - Math.sin(s.angle) * off * side + Math.cos(s.angle) * jitterAlong;
      if (z < GATE_Z + 3) continue;
      addPine(x, z, 0.9 + Math.random() * 0.7);
    }
  }
  // Scattered deep-forest pines beyond the wall for depth
  let treesPlaced = 0;
  for (let guard = 0; treesPlaced < 60 && guard < 600; guard++) {
    const x = -(WORLD_HALF_WIDTH - 3) + Math.random() * (WORLD_HALF_WIDTH - 3) * 2;
    const z = GATE_Z + 8 + Math.random() * (WORLD_MAX_Z - GATE_Z - 20);
    if (distanceToRoad(x, z) < ROAD_HALF_WIDTH + 7) continue;
    addPine(x, z, 0.8 + Math.random() * 0.8);
    treesPlaced++;
  }
  for (let i = 0; i < 30; i++) {
    const x = -(WORLD_HALF_WIDTH - 3) + Math.random() * (WORLD_HALF_WIDTH - 3) * 2;
    const z = GATE_Z + 6 + Math.random() * (WORLD_MAX_Z - GATE_Z - 14);
    if (distanceToRoad(x, z) < ROAD_HALF_WIDTH + 1.5) continue;
    const bush = new THREE.IcosahedronGeometry(0.5 + Math.random() * 0.5, 0);
    bush.scale(1, 0.65, 1);
    bush.translate(x, elevation(x, z) + 0.35, z);
    bushGeos.push(bush);
  }
  for (let i = 0; i < 14; i++) {
    const x = -(WORLD_HALF_WIDTH - 4) + Math.random() * (WORLD_HALF_WIDTH - 4) * 2;
    const z = GATE_Z + 10 + Math.random() * (WORLD_MAX_Z - GATE_Z - 24);
    if (distanceToRoad(x, z) < ROAD_HALF_WIDTH + 1.2) continue;
    const rock = new THREE.IcosahedronGeometry(0.4 + Math.random() * 0.7, 0);
    rock.scale(1.2, 0.7, 1);
    rock.translate(x, elevation(x, z) + 0.25, z);
    rockGeos.push(rock);
  }
  const addMerged = (geos: THREE.BufferGeometry[], mat: THREE.MeshStandardMaterial) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    root.add(mesh);
  };
  addMerged(trunkGeos, new THREE.MeshStandardMaterial({ color: 0x5a4128, roughness: 0.9 }));
  addMerged(leafGeos, new THREE.MeshStandardMaterial({ color: 0x2c5a33, roughness: 0.9 }));
  addMerged(bushGeos, new THREE.MeshStandardMaterial({ color: 0x3e6b30, roughness: 0.95 }));
  addMerged(rockGeos, new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.9 }));

  // Wooden fence posts along the asphalt stretch
  const postGeos: THREE.BufferGeometry[] = [];
  for (let t = 0.015; t < ASPHALT_END_T; t += 0.028) {
    const s = sampleRoad(t);
    for (const side of [-1, 1] as const) {
      const off = (ROAD_HALF_WIDTH + 1.6) * side;
      const px = s.p[0] + Math.cos(s.angle) * off;
      const pz = s.p[2] - Math.sin(s.angle) * off;
      const post = new THREE.BoxGeometry(0.14, 1.1, 0.14);
      post.translate(px, elevation(px, pz) + 0.55, pz);
      postGeos.push(post);
    }
  }
  addMerged(postGeos, new THREE.MeshStandardMaterial({ color: 0x6b5334, roughness: 0.9 }));

  // ROUTE 65 finish gate
  const poleMat2 = new THREE.MeshStandardMaterial({ color: 0x88898c, roughness: 0.5, metalness: 0.7 });
  const gateWidth = ROAD_HALF_WIDTH + 1.4;
  const finishY = elevation(FINISH.p[0], FINISH.p[2]);
  for (const side of [-1, 1] as const) {
    const px = FINISH.p[0] + Math.cos(FINISH.angle) * gateWidth * side;
    const pz = FINISH.p[2] - Math.sin(FINISH.angle) * gateWidth * side;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.2, 8), poleMat2);
    pole.position.set(px, elevation(px, pz) + 2.6, pz);
    pole.castShadow = true;
    root.add(pole);
  }
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(gateWidth * 2, 2.1),
    new THREE.MeshStandardMaterial({
      map: signTexture('ROUTE 65 →'),
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  banner.position.set(FINISH.p[0], finishY + 4.1, FINISH.p[2]);
  banner.rotation.y = FINISH.angle;
  root.add(banner);

  // Dashed center lines on the streets — merged into one draw call
  // (SwiftShader/low-end GPUs choke on per-dash meshes)
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xc9c9bd, roughness: 0.9 });
  const dashGeos: THREE.BufferGeometry[] = [];
  const pushDash = (alongX: boolean, x: number, z: number) => {
    const g = new THREE.PlaneGeometry(alongX ? 1.4 : 0.22, alongX ? 0.22 : 1.4);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0.015, z);
    dashGeos.push(g);
  };
  for (const z of [35, 75, 115]) {
    for (let x = -42; x <= 42; x += 5) pushDash(true, x, z);
  }
  for (const x of [-39.9, 0, 39.9]) {
    const z0 = x === 0 ? 41 : 33;
    for (let z = z0; z <= 113; z += 5) pushDash(false, x, z);
  }
  root.add(new THREE.Mesh(mergeGeometries(dashGeos), dashMat));

  // City street lamps (real point lights only at a few corners)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.6 });
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 4.6, 8);
  const headGeo = new THREE.SphereGeometry(0.16, 10, 8);
  for (const [lx, lz] of [
    [-6.8, 45], [6.8, 62], [-34.8, 75], [34.8, 75], [-6.8, 88], [6.8, 105], [-20, 40.8], [20, 109.2],
  ]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(lx, 2.3, lz);
    pole.castShadow = true;
    const head = new THREE.Mesh(
      headGeo,
      new THREE.MeshStandardMaterial({
        color: 0x2a2418,
        emissive: 0xffd9a0,
        emissiveIntensity: night ? 2.4 : 0,
      }),
    );
    head.position.set(lx, 4.7, lz);
    root.add(pole, head);
  }
  if (night) {
    for (const [lx, lz] of [
      [0, 40], [-20, 75], [20, 75], [0, 110],
    ]) {
      const light = new THREE.PointLight(0xffc98a, 55, 34, 1.8);
      light.position.set(lx, 5.2, lz);
      root.add(light);
    }
  }

  // Windows — warm lamps behind some at night; dead sky-glass by day.
  // Frames and same-look panes merge into few draw calls.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1712, roughness: 0.9 });
  const frameGeos: THREE.BufferGeometry[] = [];
  const litGeos: THREE.BufferGeometry[] = [];
  const darkGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const lit = night && Math.random() < 0.35;
    const x = side * (ALLEY_HALF_WIDTH - 0.02);
    const y = 3.6 + (i % 3) * 2.6;
    const z = -26 + i * 3.4;
    const frame = new THREE.BoxGeometry(0.14, 1.4, 1.1);
    frame.translate(x, y, z);
    frameGeos.push(frame);
    const pane = new THREE.BoxGeometry(0.12, 1.2, 0.9);
    pane.translate(side * ALLEY_HALF_WIDTH, y, z);
    (lit ? litGeos : darkGeos).push(pane);
  }
  root.add(new THREE.Mesh(mergeGeometries(frameGeos), frameMat));
  if (litGeos.length) {
    root.add(
      new THREE.Mesh(
        mergeGeometries(litGeos),
        new THREE.MeshStandardMaterial({
          color: 0x0d0d10,
          emissive: 0xcf9a4a,
          emissiveIntensity: 0.9,
          roughness: 0.3,
          metalness: 0.4,
        }),
      ),
    );
  }
  root.add(
    new THREE.Mesh(
      mergeGeometries(darkGeos),
      new THREE.MeshStandardMaterial({
        color: night ? 0x0d0d10 : 0x36414f,
        emissive: night ? 0x11131c : 0x000000,
        emissiveIntensity: 0.25,
        roughness: night ? 0.3 : 0.12,
        metalness: night ? 0.4 : 0.7,
      }),
    ),
  );

  const flickerItems: {
    obj: THREE.PointLight | THREE.MeshBasicMaterial;
    base: number;
    phase: number;
    neon: boolean;
  }[] = [];

  // Neon bar signs — screaming at night, switched-off glass by day
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
      opacity: night ? 1 : 0.45,
    });
    mat.toneMapped = !night;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.35), mat);
    sign.position.set(x, 4.9, z);
    sign.rotation.y = facing;
    root.add(sign);
    if (night) {
      const light = new THREE.PointLight(lightColor, 14, 14, 1.8);
      light.position.set(x + Math.sin(facing) * 0.8, 4.7, z);
      root.add(light);
      flickerItems.push({ obj: mat, base: 1, phase: Math.random() * 100, neon: true });
      flickerItems.push({ obj: light, base: 14, phase: Math.random() * 100, neon: true });
    }
  };
  addNeon('BARAS', '#ff2d78', 0xff2d78, -(ALLEY_HALF_WIDTH - 0.05), -8, Math.PI / 2);
  addNeon('ALUS', '#2dffc8', 0x2dffc8, ALLEY_HALF_WIDTH - 0.05, 14, -Math.PI / 2);

  // Graffiti + torn posters on the walls
  const addDecal = (
    canvasDraw: (ctx: CanvasRenderingContext2D) => void,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    facing: number,
  ) => {
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
    root.add(decal);
  };
  const spray = (text: string, color: string, size = 64) => (ctx: CanvasRenderingContext2D) => {
    ctx.font = `900 ${size}px system-ui, sans-serif`;
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
  addDecal(spray('Į SVEIKATĄ!', '#c33fd4', 44), 3.4, 1.7, -(ALLEY_HALF_WIDTH - 0.04), 2.2, 8, Math.PI / 2);
  addDecal(spray('ŽALGIRIS', '#4ad46a', 52), 2.8, 1.4, ALLEY_HALF_WIDTH - 0.04, 1.9, -16, -Math.PI / 2);
  addDecal(spray('LIETUVA', '#d4a53f', 54), 3.2, 1.6, ALLEY_HALF_WIDTH - 0.04, 2.4, 26, -Math.PI / 2);
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

  // Lithuanian tricolor hanging off the left wall
  const flagPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1.9, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.7 }),
  );
  flagPole.position.set(-(ALLEY_HALF_WIDTH - 0.6), 6.1, -2);
  flagPole.rotation.z = -0.9;
  root.add(flagPole);
  const stripeColors = [0xfdb913, 0x006a44, 0xc1272d];
  stripeColors.forEach((color, i) => {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.32),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }),
    );
    stripe.position.set(-(ALLEY_HALF_WIDTH - 1.55), 6.55 - i * 0.32, -1.98);
    stripe.rotation.y = Math.PI / 2 - 0.25;
    root.add(stripe);
  });

  // Basketball hoop on the far wall — šis kiemas gyvena krepšiniu
  const backboard = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.05, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.8 }),
  );
  backboard.position.set(1.5, 3.6, -(ALLEY_HALF_LENGTH - 0.05));
  const boardSquare = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x8a2f26, roughness: 0.8 }),
  );
  boardSquare.position.set(1.5, 3.5, -(ALLEY_HALF_LENGTH - 0.1));
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.03, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0xd35b2a, roughness: 0.4, metalness: 0.6 }),
  );
  rim.position.set(1.5, 3.18, -(ALLEY_HALF_LENGTH - 0.38));
  rim.rotation.x = Math.PI / 2;
  backboard.castShadow = true;
  root.add(backboard, boardSquare, rim);

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
  root.add(fe);

  // AC units dripping down the walls
  const acMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.5, metalness: 0.6 });
  for (const [side, y, z] of [
    [-1, 3.2, -22], [1, 4.4, 4], [-1, 5.0, 24],
  ]) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1), acMat);
    ac.position.set(side * (ALLEY_HALF_WIDTH - 0.35), y, z);
    ac.castShadow = true;
    root.add(ac);
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
    root.add(cable);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x332211,
        emissive: 0xffcf8a,
        emissiveIntensity: night ? 2.2 : 0.05,
      }),
    );
    bulb.position.set(0, 6.15, z + 0.6);
    root.add(bulb);
  }

  const addObstacle = (mesh: THREE.Object3D, x: number, z: number, hx: number, hz: number) => {
    mesh.position.x = x;
    mesh.position.z = z;
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    root.add(mesh);
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
    root.add(bag);
  }

  // Scattered litter — also merged into a single mesh
  const litterGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 22; i++) {
    const g = new THREE.PlaneGeometry(0.28, 0.36);
    g.applyMatrix4(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(-Math.PI / 2 + (Math.random() - 0.5) * 0.3, 0, Math.random() * Math.PI),
      ),
    );
    g.translate(-7 + Math.random() * 14, 0.02, -28 + Math.random() * 56);
    litterGeos.push(g);
  }
  root.add(
    new THREE.Mesh(
      mergeGeometries(litterGeos),
      new THREE.MeshStandardMaterial({ color: 0xa8a390, roughness: 0.95, side: THREE.DoubleSide }),
    ),
  );

  // Wall lamps with cone shades — flickering at night, off by day
  const lampShadeMat = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.5, metalness: 0.7 });
  for (const [x, z] of [
    [-7.6, -20], [7.6, -10], [-7.6, 2], [7.6, 12], [-7.6, 24],
  ]) {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.3, 12, 1, true), lampShadeMat);
    shade.position.set(x, 4.45, z);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0x332211,
        emissive: 0xffb066,
        emissiveIntensity: night ? 2.6 : 0,
      }),
    );
    bulb.position.set(x, 4.28, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), lampShadeMat);
    arm.position.set(x + (x < 0 ? -0.35 : 0.35), 4.62, z);
    root.add(shade, bulb, arm);
    if (night) {
      const light = new THREE.PointLight(0xffb066, 34, 22, 1.8);
      light.position.set(x * 0.9, 4.1, z);
      root.add(light);
      flickerItems.push({ obj: light, base: 34, phase: Math.random() * 100, neon: false });
    }
  }

  const steamVents: Vec3[] = [
    [-6.2, 0.3, -10],
    [5.6, 0.3, 20],
  ];
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.7 });
  for (const v of steamVents) {
    const grate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), ventMat);
    grate.position.set(v[0], 0.06, v[2]);
    root.add(grate);
  }

  const margin = 0.8;
  const bounds: Bounds = {
    minX: -(WORLD_HALF_WIDTH - margin),
    maxX: WORLD_HALF_WIDTH - margin,
    minZ: -(ALLEY_HALF_LENGTH - margin),
    maxZ: WORLD_MAX_Z - margin,
  };

  const sunOffset = sun.position.clone().sub(sun.target.position);

  return {
    mode,
    obstacles,
    bounds,
    steamVents,
    focusShadow(x: number, z: number) {
      // Snap to a grid so the shadow map doesn't shimmer as we move
      const sx = Math.round(x / 8) * 8;
      const sz = Math.round(z / 8) * 8;
      sun.target.position.set(sx, 0, sz);
      sun.position.copy(sun.target.position).add(sunOffset);
    },
    updateFlicker(t: number) {
      // Lazy clouds crossing the sky
      for (let i = 0; i < cloudDrift.length; i++) {
        const cloud = cloudDrift[i];
        cloud.position.x += (0.4 + (i % 3) * 0.2) * 0.016;
        if (cloud.position.x > 260) cloud.position.x = -260;
      }
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
    dispose() {
      scene.remove(root);
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if ('map' in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
            mat.dispose();
          }
        }
      });
      envTexture.dispose();
    },
  };
}

export function randomFreePos(geom: WorldGeom): Vec3 {
  const { obstacles } = geom;
  for (let tries = 0; tries < 60; tries++) {
    // ~30% alley (walkers near spawn), ~30% city streets (drivers),
    // ~40% strewn along the road to Route 65 (the expedition).
    const roll = Math.random();
    let x: number;
    let z: number;
    if (roll < 0.3) {
      x = -7 + Math.random() * 14;
      z = -28 + Math.random() * 56;
    } else if (roll < 0.6) {
      x = -44 + Math.random() * 88;
      z = 31 + Math.random() * 88;
    } else {
      const sample = sampleRoad(Math.random());
      const off = (Math.random() * 2 - 1) * (ROAD_HALF_WIDTH - 0.8);
      x = sample.p[0] + Math.cos(sample.angle) * off;
      z = sample.p[2] - Math.sin(sample.angle) * off;
    }
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
