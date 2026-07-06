import type {
  BottleKind,
  BottleState,
  PlayerState,
  SceneMode,
  Vec3,
  WorldState,
} from '../net/network';
import { BOTTLE_POINTS, CAR_SPAWNS } from '../net/network';
import { MAX_PLAYERS } from '../net/peer';

export const ROUND_SECONDS = 120;
const BOTTLE_COUNT = 26; // spread across alley + city streets
const COLLECT_RADIUS = 1.25;
const CAR_COLLECT_RADIUS = 2.4;
const CAR_ENTER_RADIUS = 3.5;
const RESPAWN_DELAY = 3;

// Weighted: beer common, vodka rare
const KIND_POOL: BottleKind[] = ['beer', 'beer', 'beer', 'wine', 'wine', 'vodka'];

const randomKind = () => KIND_POOL[Math.floor(Math.random() * KIND_POOL.length)];

function spawnLine(index: number): Vec3 {
  return [-4.5 + index * 3, 0, 0];
}

function makePlayer(id: string, name: string, colorIndex: number): PlayerState {
  return {
    id,
    name,
    colorIndex,
    p: spawnLine(colorIndex),
    ry: 0,
    moving: false,
    score: 0,
    car: null,
  };
}

// Authoritative game simulation — runs only in the host's browser.
export class HostSim {
  readonly state: WorldState;
  private clock = 0;
  private nextBottleId = 1;
  private respawns: { at: number; bottleId: number }[] = [];

  constructor(
    private randomPos: () => Vec3,
    hostId: string,
    hostName: string,
    mode: SceneMode,
  ) {
    this.state = {
      phase: 'lobby',
      mode,
      timeLeft: ROUND_SECONDS,
      players: [makePlayer(hostId, hostName, 0)],
      bottles: [],
      cars: [],
    };
  }

  addPlayer(id: string, name: string): number | null {
    if (this.state.players.length >= MAX_PLAYERS) return null;
    const used = new Set(this.state.players.map((p) => p.colorIndex));
    let colorIndex = 0;
    while (used.has(colorIndex)) colorIndex++;
    this.state.players.push(makePlayer(id, name, colorIndex));
    return colorIndex;
  }

  removePlayer(id: string) {
    const i = this.state.players.findIndex((p) => p.id === id);
    if (i >= 0) {
      const car = this.state.cars.find((c) => c.occupant === id);
      if (car) car.occupant = null;
      this.state.players.splice(i, 1);
    }
  }

  setPos(id: string, p: Vec3, ry: number, moving: boolean) {
    const player = this.state.players.find((pl) => pl.id === id);
    if (!player) return;
    player.p = p;
    player.ry = ry;
    player.moving = moving;
    if (player.car !== null) {
      const car = this.state.cars.find((c) => c.id === player.car);
      if (car) {
        car.p = p;
        car.ry = ry;
      }
    }
  }

  // Hop in the nearest free car / hop out beside the current one.
  requestCar(id: string, enter: boolean) {
    const player = this.state.players.find((pl) => pl.id === id);
    if (!player || this.state.phase !== 'play') return;
    if (enter && player.car === null) {
      for (const car of this.state.cars) {
        if (car.occupant !== null) continue;
        const dx = player.p[0] - car.p[0];
        const dz = player.p[2] - car.p[2];
        if (dx * dx + dz * dz < CAR_ENTER_RADIUS * CAR_ENTER_RADIUS) {
          car.occupant = id;
          player.car = car.id;
          player.p = [...car.p];
          player.ry = car.ry;
          return;
        }
      }
    } else if (!enter && player.car !== null) {
      const car = this.state.cars.find((c) => c.id === player.car);
      player.car = null;
      if (car) {
        car.occupant = null;
        // Step out on the car's left side
        player.p = [car.p[0] + Math.cos(car.ry) * 2, 0, car.p[2] - Math.sin(car.ry) * 2];
      }
    }
  }

  startRound() {
    const s = this.state;
    s.players.forEach((p, i) => {
      p.score = 0;
      p.p = spawnLine(i);
      p.ry = 0;
      p.car = null;
    });
    // One parked car per player at the alley exit
    s.cars = s.players.map((_, i) => ({
      id: i + 1,
      p: [...CAR_SPAWNS[i].p] as Vec3,
      ry: CAR_SPAWNS[i].ry,
      occupant: null,
    }));
    s.bottles = [];
    this.respawns = [];
    for (let i = 0; i < BOTTLE_COUNT; i++) {
      s.bottles.push(this.makeBottle());
    }
    s.timeLeft = ROUND_SECONDS;
    s.phase = 'play';
  }

  private makeBottle(): BottleState {
    return {
      id: this.nextBottleId++,
      kind: randomKind(),
      p: this.randomPos(),
      active: true,
    };
  }

  tick(dt: number) {
    this.clock += dt;
    const s = this.state;
    if (s.phase !== 'play') return;

    s.timeLeft = Math.max(0, s.timeLeft - dt);
    if (s.timeLeft === 0) {
      s.phase = 'end';
      return;
    }

    for (const bottle of s.bottles) {
      if (!bottle.active) continue;
      for (const player of s.players) {
        const dx = player.p[0] - bottle.p[0];
        const dz = player.p[2] - bottle.p[2];
        const radius = player.car !== null ? CAR_COLLECT_RADIUS : COLLECT_RADIUS;
        if (dx * dx + dz * dz < radius * radius) {
          bottle.active = false;
          player.score += BOTTLE_POINTS[bottle.kind];
          this.respawns.push({ at: this.clock + RESPAWN_DELAY, bottleId: bottle.id });
          break;
        }
      }
    }

    this.respawns = this.respawns.filter((r) => {
      if (r.at > this.clock) return true;
      const bottle = s.bottles.find((b) => b.id === r.bottleId);
      if (bottle) {
        bottle.kind = randomKind();
        bottle.p = this.randomPos();
        bottle.active = true;
      }
      return false;
    });
  }
}
