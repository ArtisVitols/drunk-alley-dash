import type {
  BottleKind,
  BottleState,
  BumState,
  CarState,
  PlayerState,
  SceneMode,
  Vec3,
  WorldState,
} from '../net/network';
import { BOTTLE_POINTS, CAR_SEATS, CAR_SPAWNS } from '../net/network';
import { MAX_PLAYERS } from '../net/peer';
import { TRAILER_RADIUS, carRadius, trailerCenterXZ } from './car';
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

// Bums: stinky drifters after the vehicles. They shamble in, cling to
// a door (the vehicle can't drive off), soak up stick hits, then flee
// screaming. A team job: everyone piles out and whacks together.
const BUM_HP = 3;
const BUM_WALK_SPEED = 2.1;
const BUM_FLEE_SPEED = 5.5;
const BUM_FLEE_SECONDS = 4.5;
const BUM_CLING_MARGIN = 1.0; // reach past the vehicle's collision circle
const BUM_MAX = 4;
const BUM_FIRST_WAVE = 14; // seconds into the round
const HIT_RANGE = 2.6;

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
    swing: 0,
  };
}

// Nearest boardable point of a vehicle for a bum at (x, z): the cab,
// or for the caravan also the towed camper. Returns the door point and
// how close counts as "at the door".
function bumTarget(car: CarState, x: number, z: number): { tx: number; tz: number; reach: number } {
  let tx = car.p[0];
  let tz = car.p[2];
  let reach = carRadius(car.kind) + BUM_CLING_MARGIN;
  if (car.kind === 'caravan') {
    const [cx, cz] = trailerCenterXZ(car.p[0], car.p[2], car.ry, car.tr);
    const dCab = (x - tx) * (x - tx) + (z - tz) * (z - tz);
    const dCamper = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (dCamper < dCab) {
      tx = cx;
      tz = cz;
      reach = TRAILER_RADIUS + BUM_CLING_MARGIN;
    }
  }
  return { tx, tz, reach };
}

// Authoritative game simulation — runs only in the host's browser.
// No round timer: the session runs until the host closes the room.
export class HostSim {
  readonly state: WorldState;
  private clock = 0;
  private nextBottleId = 1;
  private respawns: { at: number; bottleId: number }[] = [];
  private nextBumId = 1;
  private bumWaveAt = 0;
  private bumFleeUntil = new Map<number, number>();

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
      bums: [],
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

  setPos(
    id: string,
    p: Vec3,
    ry: number,
    moving: boolean,
    working: boolean,
    tr?: number,
    sw?: number,
  ) {
    const player = this.state.players.find((pl) => pl.id === id);
    if (!player) return;
    const swung = sw !== undefined && sw > player.swing;
    if (sw !== undefined) player.swing = sw;
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
    // A new swing of the stick (counter advanced): whack the nearest
    // bum in reach. Only on foot — no swinging out the car window.
    if (swung) this.applyHit(player);
  }

  // One stick hit: the nearest bum within arm's reach takes damage;
  // out of hp he bolts away from the swinger, screaming.
  private applyHit(player: PlayerState) {
    let best: BumState | null = null;
    let bestD = HIT_RANGE * HIT_RANGE;
    for (const bum of this.state.bums) {
      if (bum.mode === 'flee') continue;
      const dx = bum.p[0] - player.p[0];
      const dz = bum.p[2] - player.p[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = bum;
      }
    }
    if (!best) return;
    best.hp -= 1;
    if (best.hp <= 0) {
      best.mode = 'flee';
      // Run away from whoever landed the last hit
      best.ry = Math.atan2(best.p[0] - player.p[0], best.p[2] - player.p[2]);
      this.bumFleeUntil.set(best.id, this.clock + BUM_FLEE_SECONDS);
    }
  }

  // Test/dev hook (also used by ?dev=1): drop a bum next to a spot
  spawnBum(x: number, z: number) {
    if (this.state.phase !== 'play' || this.state.cars.length === 0) return;
    this.state.bums.push(this.makeBum(x, z));
  }

  private makeBum(x: number, z: number): BumState {
    // Chase whichever vehicle is nearest to the spawn point
    let carId = this.state.cars[0].id;
    let bestD = Infinity;
    for (const car of this.state.cars) {
      const dx = car.p[0] - x;
      const dz = car.p[2] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        carId = car.id;
      }
    }
    return {
      id: this.nextBumId++,
      kind: Math.random() < 0.5 ? 'man' : 'woman',
      p: [x, 0, z],
      ry: 0,
      hp: BUM_HP,
      mode: 'walk',
      car: carId,
    };
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
    s.bums = [];
    this.bumFleeUntil.clear();
    this.bumWaveAt = this.clock + BUM_FIRST_WAVE;
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

    // ——— Bums ————————————————————————————————————————————————
    // Waves of stinky drifters. They spawn a short walk away from a
    // vehicle, shamble to its door, and cling there banging until the
    // team piles out and whacks them away with sticks.
    if (this.clock >= this.bumWaveAt) {
      const room = BUM_MAX - s.bums.length;
      const count = Math.min(room, 1 + Math.ceil(s.players.length / 2));
      const targetCar = s.cars[Math.floor(Math.random() * s.cars.length)];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 22 + Math.random() * 10;
        this.spawnBum(
          targetCar.p[0] + Math.sin(angle) * dist,
          targetCar.p[2] + Math.cos(angle) * dist,
        );
      }
      this.bumWaveAt = this.clock + 40 + Math.random() * 25;
    }
    s.bums = s.bums.filter((bum) => {
      if (bum.mode === 'flee') {
        bum.p[0] += Math.sin(bum.ry) * BUM_FLEE_SPEED * dt;
        bum.p[2] += Math.cos(bum.ry) * BUM_FLEE_SPEED * dt;
        if (this.clock >= (this.bumFleeUntil.get(bum.id) ?? 0)) {
          this.bumFleeUntil.delete(bum.id);
          return false;
        }
        return true;
      }
      const car = s.cars.find((c) => c.id === bum.car);
      if (!car) return false;
      const { tx, tz, reach } = bumTarget(car, bum.p[0], bum.p[2]);
      const dx = tx - bum.p[0];
      const dz = tz - bum.p[2];
      const d = Math.hypot(dx, dz);
      bum.ry = Math.atan2(dx, dz);
      // Small epsilon: the walk step converges on exactly `reach`, so a
      // strict check would leave him walking in place, never clinging
      if (d > reach + 0.05) {
        bum.mode = 'walk';
        const step = Math.min(BUM_WALK_SPEED * dt, d - reach);
        bum.p[0] += (dx / d) * step;
        bum.p[2] += (dz / d) * step;
      } else {
        bum.mode = 'bang';
      }
      return true;
    });

    // Victory: any occupied vehicle reaches the ROUTE 65 junction
    for (const car of s.cars) {
      if (car.occupants.length > 0 && car.p[2] >= FINISH.p[2] - 3) {
        s.phase = 'won';
        break;
      }
    }
  }
}
