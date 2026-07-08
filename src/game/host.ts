import type {
  BottleKind,
  BottleState,
  PlayerState,
  SceneMode,
  Vec3,
  WorldState,
} from '../net/network';
import { BOTTLE_POINTS, CAR_SEATS, CAR_SPAWNS } from '../net/network';
import { MAX_PLAYERS } from '../net/peer';
import { trailerCenterXZ } from './car';
import { FINISH, ROAD_OBSTACLE_DEFS, sampleRoad } from './road';

const BOTTLE_COUNT = 34; // spread across alley + city + the road
const COLLECT_RADIUS = 1.25;
const CAR_COLLECT_RADIUS = 2.4;
const CAR_ENTER_RADIUS = 3.5;
const RESPAWN_DELAY = 3;
// Measured from the obstacle CENTER — obstacles span ~4.2 half-width
// across the road, so this must reach past their collision pushout.
const WORK_RADIUS = 6.0;
const CLEAR_SECONDS_SOLO = 15; // full team of 4 → ~3.75 s

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
    working: false,
    score: 0,
    car: null,
  };
}

// Authoritative game simulation — runs only in the host's browser.
// No round timer: the session runs until the host closes the room.
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
      players: [makePlayer(hostId, hostName, 0)],
      bottles: [],
      cars: [],
      roadObstacles: [],
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
      for (const car of this.state.cars) {
        const seat = car.occupants.indexOf(id);
        if (seat >= 0) car.occupants.splice(seat, 1);
      }
      this.state.players.splice(i, 1);
    }
  }

  private carOf(playerId: string) {
    return this.state.cars.find((c) => c.occupants.includes(playerId));
  }

  setPos(id: string, p: Vec3, ry: number, moving: boolean, working: boolean, tr?: number) {
    const player = this.state.players.find((pl) => pl.id === id);
    if (!player) return;
    if (player.car !== null) {
      const car = this.carOf(id);
      // Only the driver steers the car; passenger pos reports are ignored
      // (their position is pinned to the car in tick()).
      if (car && car.occupants[0] === id) {
        car.p = p;
        car.ry = ry;
        car.tr = tr ?? ry;
        player.p = p;
        player.ry = ry;
        player.moving = moving;
      }
      player.working = false;
      return;
    }
    player.p = p;
    player.ry = ry;
    player.moving = moving;
    player.working = working;
  }

  // Hop into the nearest car with a free seat / hop out beside it.
  // First one in is the driver; when the driver leaves, the next
  // occupant inherits the wheel.
  requestCar(id: string, enter: boolean) {
    const player = this.state.players.find((pl) => pl.id === id);
    if (!player || this.state.phase !== 'play') return;
    if (enter && player.car === null) {
      let best: (typeof this.state.cars)[number] | null = null;
      let bestD = CAR_ENTER_RADIUS * CAR_ENTER_RADIUS;
      for (const car of this.state.cars) {
        if (car.occupants.length >= CAR_SEATS) continue;
        const dx = player.p[0] - car.p[0];
        const dz = player.p[2] - car.p[2];
        let d2 = dx * dx + dz * dz;
        if (car.kind === 'caravan') {
          // The camper door counts too — board from beside the trailer
          const [tx, tz] = trailerCenterXZ(car.p[0], car.p[2], car.ry, car.tr);
          const tdx = player.p[0] - tx;
          const tdz = player.p[2] - tz;
          d2 = Math.min(d2, tdx * tdx + tdz * tdz);
        }
        if (d2 < bestD) {
          bestD = d2;
          best = car;
        }
      }
      if (best) {
        best.occupants.push(id);
        player.car = best.id;
        player.p = [...best.p];
        player.ry = best.ry;
      }
    } else if (!enter && player.car !== null) {
      const car = this.carOf(id);
      player.car = null;
      if (car) {
        const seat = car.occupants.indexOf(id);
        car.occupants.splice(seat, 1);
        // Step out on the car's left side, staggered per seat
        player.p = [
          car.p[0] + Math.cos(car.ry) * (2 + seat * 0.7),
          0,
          car.p[2] - Math.sin(car.ry) * (2 + seat * 0.7),
        ];
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
    // The team fleet: the RV, and the sedan towing the camper ahead of it
    s.cars = CAR_SPAWNS.map((spawn, i) => ({
      id: i + 1,
      kind: spawn.kind,
      p: [...spawn.p] as Vec3,
      ry: spawn.ry,
      tr: spawn.ry,
      occupants: [],
    }));
    // Fresh run: the road out of town is blocked again
    s.roadObstacles = ROAD_OBSTACLE_DEFS.map((def) => {
      const sample = sampleRoad(def.t);
      return {
        id: def.id,
        kind: def.kind,
        p: sample.p,
        ry: sample.angle,
        progress: 0,
        cleared: false,
      };
    });
    s.bottles = [];
    this.respawns = [];
    for (let i = 0; i < BOTTLE_COUNT; i++) {
      s.bottles.push(this.makeBottle());
    }
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

    // Pin every occupant to their car (passengers ride along)
    for (const car of s.cars) {
      for (const pid of car.occupants) {
        const player = s.players.find((pl) => pl.id === pid);
        if (player) {
          player.p = [...car.p];
          player.ry = car.ry;
        }
      }
    }

    // Collection: on-foot players and drivers. Passengers are along
    // for the ride — they share the car's position, so letting them
    // collect would just duplicate the driver's pickups.
    for (const bottle of s.bottles) {
      if (!bottle.active) continue;
      for (const player of s.players) {
        if (player.car !== null) {
          const car = this.carOf(player.id);
          if (!car || car.occupants[0] !== player.id) continue;
        }
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

    // Team clears road obstacles just by standing at them on foot —
    // no button gymnastics (mobile hold gestures proved unreliable).
    // More helpers = faster.
    for (const ob of s.roadObstacles) {
      if (ob.cleared) continue;
      let workers = 0;
      for (const pl of s.players) {
        if (pl.car !== null) continue;
        const dx = pl.p[0] - ob.p[0];
        const dz = pl.p[2] - ob.p[2];
        if (dx * dx + dz * dz < WORK_RADIUS * WORK_RADIUS) workers++;
      }
      if (workers > 0) {
        ob.progress = Math.min(1, ob.progress + (workers * dt) / CLEAR_SECONDS_SOLO);
        if (ob.progress >= 1) ob.cleared = true;
      }
    }

    // Victory: any occupied vehicle reaches the ROUTE 65 junction
    for (const car of s.cars) {
      if (car.occupants.length > 0 && car.p[2] >= FINISH.p[2] - 3) {
        s.phase = 'won';
        break;
      }
    }
  }
}
