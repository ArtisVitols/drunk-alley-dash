export type Vec3 = [number, number, number];

export type BottleKind = 'beer' | 'wine' | 'vodka';

export const BOTTLE_POINTS: Record<BottleKind, number> = {
  beer: 1,
  wine: 2,
  vodka: 3,
};

export type Phase = 'lobby' | 'play' | 'end';

export type SceneMode = 'day' | 'night';

export interface PlayerState {
  id: string;
  name: string;
  colorIndex: number;
  p: Vec3;
  ry: number;
  moving: boolean;
  score: number;
  car: number | null;
}

export interface CarState {
  id: number;
  p: Vec3;
  ry: number;
  occupant: string | null;
}

// Parking spots on the street just outside the alley exit; one car
// per player spawns here at round start.
export const CAR_SPAWNS: { p: Vec3; ry: number }[] = [
  { p: [-14, 0, 35], ry: Math.PI / 2 },
  { p: [-20, 0, 35], ry: Math.PI / 2 },
  { p: [14, 0, 35], ry: -Math.PI / 2 },
  { p: [20, 0, 35], ry: -Math.PI / 2 },
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
  timeLeft: number;
  players: PlayerState[];
  bottles: BottleState[];
  cars: CarState[];
}

export type ClientMsg =
  | { t: 'hi'; name: string }
  | { t: 'pos'; p: Vec3; ry: number; moving: boolean }
  | { t: 'car'; enter: boolean };

export type HostMsg =
  | { t: 'welcome'; id: string; colorIndex: number }
  | { t: 'full' }
  | { t: 'state'; state: WorldState };
