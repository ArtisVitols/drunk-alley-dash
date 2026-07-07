import * as THREE from 'three';
import type { RoadObstacleKind, Vec3 } from '../net/network';

// The road out of the city: a winding country lane from the north gate
// to the ROUTE 65 junction. Shared by the scene (visuals), the host sim
// (obstacles, finish line) and movement code (surface lookup).

export const GATE_Z = 120;
export const ROAD_HALF_WIDTH = 4.5;
export const ASPHALT_END_T = 0.35; // asphalt gives way to sand here

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
];

export const roadCurve = new THREE.CatmullRomCurve3(
  CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
  false,
  'catmullrom',
  0.5,
);

const SAMPLE_COUNT = 240;
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

function nearestSample(x: number, z: number): { d: number; t: number } {
  let best = Infinity;
  let bestT = 0;
  for (const s of samples) {
    const d = (x - s.x) ** 2 + (z - s.z) ** 2;
    if (d < best) {
      best = d;
      bestT = s.t;
    }
  }
  return { d: Math.sqrt(best), t: bestT };
}

export function distanceToRoad(x: number, z: number): number {
  return nearestSample(x, z).d;
}

export type Surface = 'city' | 'asphalt' | 'sand' | 'grass';

export function roadSurface(x: number, z: number): Surface {
  if (z <= GATE_Z) return 'city';
  const near = nearestSample(x, z);
  if (near.d <= ROAD_HALF_WIDTH) return near.t < ASPHALT_END_T ? 'asphalt' : 'sand';
  return 'grass';
}

export const FINISH = sampleRoad(0.99);

export const ROAD_OBSTACLE_DEFS: { id: number; kind: RoadObstacleKind; t: number }[] = [
  { id: 1, kind: 'roadblock', t: 0.1 },
  { id: 2, kind: 'log', t: 0.28 },
  { id: 3, kind: 'boulders', t: 0.48 },
  { id: 4, kind: 'junk', t: 0.66 },
  { id: 5, kind: 'log', t: 0.84 },
];
