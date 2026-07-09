import * as THREE from 'three';
import type { RoadObstacleKind, Vec3 } from '../net/network';

// The road out of the city: a winding country lane from the north gate
// to the ROUTE 65 junction. Shared by the scene (visuals), the host sim
// (obstacles, finish line) and movement code (surface lookup).

export const GATE_Z = 120;
export const ROAD_HALF_WIDTH = 4.5;
// Surface bands along the (extended) curve: asphalt → sand → gravel →
// mud. The t values are arc-fractions of the FULL 880 m road; the first
// two boundaries sit exactly where they did before the extension.
export const ASPHALT_END_T = 0.1575; // asphalt gives way to sand here
export const GRAVEL_START_T = 0.4537; // the old road end — gravel begins
export const MUD_START_T = 0.7873; // river lowlands — mud to the finish

// The original lane to the old ROUTE 65 junction (z 442), then the
// extension: a much longer winding drive with action sites spread out
// along it — dead animals, a bum camp, the river crossing — ending at
// the relocated ROUTE 65 finish (z ~843).
const CONTROL_POINTS: [number, number][] = [
  [0, 116],
  [0, 134],
  [16, 160],
  [-14, 192],
  [12, 226],
  [-18, 264],
  [14, 302],
  [-12, 342],
  [8, 382],
  [-4, 416],
  [0, 442],
  [14, 474],
  [-18, 512],
  [10, 552],
  [-16, 594],
  [6, 634],
  [-14, 676],
  [16, 720],
  [-12, 762],
  [8, 800],
  [-2, 830],
  [0, 852],
];

export const roadCurve = new THREE.CatmullRomCurve3(
  CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'catmullrom',
  0.5,
);

const SAMPLE_COUNT = 520; // the extended road is ~880 m — keep samples dense
const samples: { x: number; z: number; t: number }[] = [];
for (let i = 0; i <= SAMPLE_COUNT; i++) {
  const t = i / SAMPLE_COUNT;
  const p = roadCurve.getPointAt(t);
  samples.push({ x: p.x, z: p.z, t });
}

export function sampleRoad(t: number): { p: Vec3; angle: number } {
  const p = roadCurve.getPointAt(t);
  const tangent = roadCurve.getTangentAt(t);
  return { p: [p.x, 0, p.z], angle: Math.atan2(tangent.x, tangent.z) };
}

function nearestSample(x: number, z: number): { d: number; t: number; sx: number; sz: number } {
  let best = Infinity;
  let bestT = 0;
  let bx = 0;
  let bz = 0;
  for (const s of samples) {
    const d = (x - s.x) ** 2 + (z - s.z) ** 2;
    if (d < best) {
      best = d;
      bestT = s.t;
      bx = s.x;
      bz = s.z;
    }
  }
  return { d: Math.sqrt(best), t: bestT, sx: bx, sz: bz };
}

// Past the gate the drivable world is a corridor hugging the road —
// the forest wall. Pushes the position back toward the road center if
// it strays; returns true when it had to (counts as a collision).
const CORRIDOR_MARGIN = 2.0;

export function clampToRoadCorridor(
  pos: { x: number; z: number },
  radius: number,
): boolean {
  if (pos.z <= GATE_Z) return false;
  const near = nearestSample(pos.x, pos.z);
  const limit = ROAD_HALF_WIDTH + CORRIDOR_MARGIN - radius;
  if (near.d <= limit) return false;
  if (near.d > 1e-4) {
    const k = limit / near.d;
    pos.x = near.sx + (pos.x - near.sx) * k;
    pos.z = near.sz + (pos.z - near.sz) * k;
  }
  return true;
}

// ——— Elevation: flat city, rolling hills along the road ———————————————

const HILL_RAMP = 40; // meters past the gate before full hill amplitude

function rampIn(z: number): number {
  const k = (z - GATE_Z) / HILL_RAMP;
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  return k * k * (3 - 2 * k); // smoothstep
}

// Height of the road surface (and its verge) at a given z
function baseHill(z: number): number {
  return (
    rampIn(z) *
    (3.2 * Math.sin((z - 148) / 12.1) * Math.sin((z - 148) / 27.7) +
      2.4 * Math.sin((z - 120) / 19.3))
  );
}

export function elevation(x: number, z: number): number {
  if (z <= GATE_Z) return 0;
  let h = baseHill(z);
  // Off the corridor the countryside rolls on its own
  const d = distanceToRoad(x, z);
  const off = Math.min(1, Math.max(0, (d - (ROAD_HALF_WIDTH + 3)) / 22));
  if (off > 0) {
    h += off * rampIn(z) * (2.6 * Math.sin(x / 13.7 + z / 21.3) + 1.7 * Math.sin(x / 6.1 - z / 29.7));
  }
  return h;
}

export function distanceToRoad(x: number, z: number): number {
  return nearestSample(x, z).d;
}

export function nearestRoadT(x: number, z: number): number {
  return nearestSample(x, z).t;
}

export type Surface = 'city' | 'asphalt' | 'sand' | 'gravel' | 'mud' | 'grass';

export function roadSurface(x: number, z: number): Surface {
  if (z <= GATE_Z) return 'city';
  const near = nearestSample(x, z);
  if (near.d > ROAD_HALF_WIDTH) return 'grass';
  if (near.t < ASPHALT_END_T) return 'asphalt';
  if (near.t < GRAVEL_START_T) return 'sand';
  if (near.t < MUD_START_T) return 'gravel';
  return 'mud';
}

export const FINISH = sampleRoad(0.99);

// The river crosses the road here; the bridge obstacle spans it and
// the scene draws the water band at this sample.
export const RIVER_T = 0.8027;

// t values are arc-fractions of the extended curve; ids 1-5 sit at the
// exact same world spots they occupied before the road grew.
export const ROAD_OBSTACLE_DEFS: { id: number; kind: RoadObstacleKind; t: number }[] = [
  { id: 1, kind: 'roadblock', t: 0.045 },
  { id: 2, kind: 'log', t: 0.126 },
  { id: 3, kind: 'boulders', t: 0.2157 },
  { id: 4, kind: 'junk', t: 0.2968 },
  { id: 5, kind: 'log', t: 0.3777 },
  // The extension: long drives between bigger jobs
  { id: 6, kind: 'carcass', t: 0.5577 },
  { id: 7, kind: 'bumcamp', t: 0.6823 },
  { id: 8, kind: 'bridge', t: RIVER_T },
  { id: 9, kind: 'carcass', t: 0.9185 },
];
