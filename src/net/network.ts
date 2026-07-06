export type Vec3 = [number, number, number];

export type BottleKind = 'beer' | 'wine' | 'vodka';

export const BOTTLE_POINTS: Record<BottleKind, number> = {
  beer: 1,
  wine: 2,
  vodka: 3,
};

export type Phase = 'lobby' | 'play' | 'end';

export interface PlayerState {
  id: string;
  name: string;
  colorIndex: number;
  p: Vec3;
  ry: number;
  moving: boolean;
  score: number;
}

export interface BottleState {
  id: number;
  kind: BottleKind;
  p: Vec3;
  active: boolean;
}

export interface WorldState {
  phase: Phase;
  timeLeft: number;
  players: PlayerState[];
  bottles: BottleState[];
}

export type ClientMsg =
  | { t: 'hi'; name: string }
  | { t: 'pos'; p: Vec3; ry: number; moving: boolean };

export type HostMsg =
  | { t: 'welcome'; id: string; colorIndex: number }
  | { t: 'full' }
  | { t: 'state'; state: WorldState };
