export type Vec3 = [number, number, number];

export type BottleKind = 'beer' | 'wine' | 'vodka';

export const BOTTLE_POINTS: Record<BottleKind, number> = {
  beer: 1,
  wine: 2,
  vodka: 3,
};

export type Phase = 'lobby' | 'play' | 'won';

export type SceneMode = 'day' | 'night';

export interface PlayerState {
  id: string;
  name: string;
  colorIndex: number;
  p: Vec3;
  ry: number;
  moving: boolean;
  working: boolean;
  score: number;
  car: number | null;
}

export type RoadObstacleKind = 'log' | 'boulders' | 'roadblock' | 'junk';

export interface RoadObstacleState {
  id: number;
  kind: RoadObstacleKind;
  p: Vec3;
  ry: number;
  progress: number;
  cleared: boolean;
}

export type CarKind = 'sedan' | 'van' | 'rv' | 'truck';

export const CAR_SEATS = 4; // 1 driver + 3 passengers

export interface CarState {
  id: number;
  kind: CarKind;
  p: Vec3;
  ry: number;
  // occupants[0] is the driver; the rest are passengers in seat order
  occupants: string[];
}

// The permanent fleet parked on the street outside the alley exit —
// always all four, any player can take any of them.
export const CAR_SPAWNS: { kind: CarKind; p: Vec3; ry: number }[] = [
  { kind: 'sedan', p: [-13.5, 0, 35], ry: Math.PI / 2 },
  { kind: 'van', p: [-21, 0, 35], ry: Math.PI / 2 },
  { kind: 'rv', p: [14, 0, 35], ry: -Math.PI / 2 },
  { kind: 'truck', p: [22, 0, 35], ry: -Math.PI / 2 },
];

export interface BottleState {
  id: number;
  kind: BottleKind;
  p: Vec3;
  active: boolean;
}

export interface WorldState {
  phase: Phase;
  mode: SceneMode;
  players: PlayerState[];
  bottles: BottleState[];
  cars: CarState[];
  roadObstacles: RoadObstacleState[];
}

export type ClientMsg =
  | { t: 'hi'; name: string }
  | { t: 'pos'; p: Vec3; ry: number; moving: boolean; working: boolean }
  | { t: 'car'; enter: boolean };

export type HostMsg =
  | { t: 'welcome'; id: string; colorIndex: number }
  | { t: 'full' }
  | { t: 'state'; state: WorldState };
