import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { ClientMsg, HostMsg, Vec3, WorldState } from './network';

export const MAX_PLAYERS = 4;

const ID_PREFIX = 'drunk-alley-dash-v1-';
// No easily-confused characters (I/O/0/1)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';

function makeCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

type PeerError = Error & { type?: string };

export class HostRoom {
  onJoin: (id: string, name: string) => number | null = () => null;
  onLeave: (id: string) => void = () => {};
  onPos: (id: string, p: Vec3, ry: number, moving: boolean, working: boolean) => void =
    () => {};
  onCar: (id: string, enter: boolean) => void = () => {};

  private conns = new Map<string, DataConnection>();
  private lastSeen = new Map<string, number>();

  private constructor(
    readonly code: string,
    private peer: Peer,
  ) {
    peer.on('connection', (conn) => this.handleConn(conn));
  }

  static create(): Promise<HostRoom> {
    return new Promise((resolve, reject) => {
      const attempt = (triesLeft: number) => {
        const code = makeCode();
        const peer = new Peer(ID_PREFIX + code);
        peer.on('open', () => resolve(new HostRoom(code, peer)));
        peer.on('error', (err: PeerError) => {
          peer.destroy();
          if (err.type === 'unavailable-id' && triesLeft > 0) {
            attempt(triesLeft - 1);
          } else {
            reject(err);
          }
        });
      };
      attempt(5);
    });
  }

  get myId(): string {
    return this.peer.id;
  }

  private handleConn(conn: DataConnection) {
    conn.on('data', (raw) => {
      const msg = raw as ClientMsg;
      this.lastSeen.set(conn.peer, performance.now());
      if (msg.t === 'hi') {
        const colorIndex = this.onJoin(conn.peer, msg.name);
        if (colorIndex === null) {
          conn.send({ t: 'full' } satisfies HostMsg);
          setTimeout(() => conn.close(), 200);
          return;
        }
        this.conns.set(conn.peer, conn);
        conn.send({ t: 'welcome', id: conn.peer, colorIndex } satisfies HostMsg);
      } else if (msg.t === 'pos') {
        this.onPos(conn.peer, msg.p, msg.ry, msg.moving, msg.working ?? false);
      } else if (msg.t === 'car') {
        this.onCar(conn.peer, msg.enter);
      }
    });
    const drop = () => {
      this.lastSeen.delete(conn.peer);
      if (this.conns.delete(conn.peer)) this.onLeave(conn.peer);
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  broadcast(state: WorldState) {
    const msg: HostMsg = { t: 'state', state };
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(msg);
    }
    this.checkTimeouts();
  }

  // PeerJS 'close' does not fire reliably when a peer's browser dies,
  // so drop anyone who has gone silent (clients send pos ~15 Hz).
  private checkTimeouts() {
    const cutoff = performance.now() - 5000;
    for (const [id, conn] of this.conns) {
      if ((this.lastSeen.get(id) ?? Infinity) < cutoff) {
        this.conns.delete(id);
        this.lastSeen.delete(id);
        conn.close();
        this.onLeave(id);
      }
    }
  }
}

export class ClientRoom {
  onState: (state: WorldState) => void = () => {};
  onClosed: (reason: string) => void = () => {};

  private lastStateAt = performance.now();
  private closed = false;

  private constructor(
    peer: Peer,
    private conn: DataConnection,
    readonly myId: string,
    readonly colorIndex: number,
  ) {
    conn.on('data', (raw) => {
      const msg = raw as HostMsg;
      if (msg.t === 'state') {
        this.lastStateAt = performance.now();
        this.onState(msg.state);
      }
    });
    const close = (reason: string) => {
      if (this.closed) return;
      this.closed = true;
      this.onClosed(reason);
    };
    conn.on('close', () => close('Host disconnected'));
    peer.on('error', () => close('Connection lost'));
    // Same reliability caveat as on the host: detect a silently dead host
    setInterval(() => {
      if (performance.now() - this.lastStateAt > 8000) close('Lost connection to the host');
    }, 2000);
  }

  static join(code: string, name: string): Promise<ClientRoom> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail('Could not reach the room (timed out)'), 12000);

      peer.on('error', (err: PeerError) => {
        if (err.type === 'peer-unavailable') fail('Room not found — check the code');
        else if (!settled) fail('Connection error — try again');
      });

      peer.on('open', () => {
        const conn = peer.connect(ID_PREFIX + code.toUpperCase().trim(), { reliable: true });
        conn.on('open', () => conn.send({ t: 'hi', name } satisfies ClientMsg));
        conn.on('data', (raw) => {
          const msg = raw as HostMsg;
          if (settled) return;
          if (msg.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            resolve(new ClientRoom(peer, conn, msg.id, msg.colorIndex));
          } else if (msg.t === 'full') {
            clearTimeout(timer);
            fail('Room is full (4 players max)');
          }
        });
      });
    });
  }

  sendPos(p: Vec3, ry: number, moving: boolean, working: boolean) {
    if (this.conn.open) {
      this.conn.send({ t: 'pos', p, ry, moving, working } satisfies ClientMsg);
    }
  }

  sendCar(enter: boolean) {
    if (this.conn.open) {
      this.conn.send({ t: 'car', enter } satisfies ClientMsg);
    }
  }
}
