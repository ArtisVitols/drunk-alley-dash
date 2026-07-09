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
  // Stick-swing counter: increments on every whack so remote clients
  // can animate swings without a dedicated message
  swing: number;
}

export type BumKind = 'man' | 'woman';

// Stinky drifters who want into the team's vehicles. Host-simulated:
// they shamble toward a vehicle, cling to its door (blocking driving),
// and flee screaming after enough stick hits.
export interface BumState {
  id: number;
  kind: BumKind;
  p: Vec3;
  ry: number;
  hp: number;
  // block = squatting on the road at a bum camp, not chasing vehicles
  mode: 'walk' | 'bang' | 'flee' | 'block';
  // Target vehicle id (the one they're trying to board); 0 for blockers
  car: number;
  // Owning bumcamp obstacle id (block mode only)
  site?: number;
}

// carcass = dead animals to drag off; bridge = river crossing that the
// team BUILDS (cleared = bridge in place); bumcamp = road bums that
// must be whacked away with sticks (progress = bums beaten)
export type RoadObstacleKind =
  | 'log'
  | 'boulders'
  | 'roadblock'
  | 'junk'
  | 'carcass'
  | 'bridge'
  | 'bumcamp';

export interface RoadObstacleState {
  id: number;
  kind: RoadObstacleKind;
  p: Vec3;
  ry: number;
  progress: number;
  cleared: boolean;
}

export type CarKind = 'sedan' | 'van' | 'rv' | 'truck' | 'caravan';

export const CAR_SEATS = 4; // 1 driver + 3 passengers

export interface CarState {
  id: number;
  kind: CarKind;
  p: Vec3;
  ry: number;
  // Trailer heading (world yaw) for towing kinds; equals ry when parked
  tr: number;
  // occupants[0] is the driver; the rest are passengers in seat order
  occupants: string[];
}

// The team fleet, parked on the main street pointing at the city gate:
// the RV, and ahead of it a sedan towing a camper. Each seats 4.
export const CAR_SPAWNS: { kind: CarKind; p: Vec3; ry: number }[] = [
  { kind: 'rv', p: [0, 0, 42], ry: 0 },
  { kind: 'caravan', p: [0, 0, 56], ry: 0 },
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
  bums: BumState[];
}

export type ClientMsg =
  | { t: 'hi'; name: string }
  | { t: 'pos'; p: Vec3; ry: number; moving: boolean; working: boolean; tr?: number; sw?: number }
  | { t: 'car'; enter: boolean };

export type HostMsg =
  | { t: 'welcome'; id: string; colorIndex: number }
  | { t: 'full' }
  | { t: 'state'; state: WorldState };
