// Mobile touch controls with three switchable schemes. All schemes share
// the same conditioning pipeline that the old raw joystick lacked: a radial
// deadzone (thumbs never rest perfectly centered), an expo curve on the
// turn axis (fine steering near center, full rate at the edge), per-frame
// smoothing toward the target axes (kills pointer-event jitter), and a
// joystick base that follows the thumb when it overshoots the ring, so
// reversing direction responds instantly instead of after a long drag back.

export type ControlMode = 'stick' | 'point' | 'dual';

const MODES: ControlMode[] = ['stick', 'point', 'dual'];

const MODE_META: Record<ControlMode, { icon: string; name: string; help: string }> = {
  stick: {
    icon: '🕹',
    name: 'Joystick',
    help: 'Drag anywhere: up walks, sideways turns',
  },
  point: {
    icon: '👉',
    name: 'Point to go',
    help: 'Drag anywhere: he heads where you point',
  },
  dual: {
    icon: '🎮',
    name: 'Two thumbs',
    help: 'Left thumb: walk / gas &nbsp; right thumb: turn',
  },
};

const HELP_SUFFIX =
  ' &nbsp;·&nbsp; 🚗 button for cars &nbsp; stand at junk to clear &nbsp;·&nbsp; 🍺 +1 🍷 +2 🥃 +3';

const RADIUS = 70; // px of thumb travel for full deflection
const DEADZONE = 0.14;
const SMOOTH_TAU = 0.075; // seconds to ~63% of a step change
const STORE_KEY = 'dad.controlMode';

interface Finger {
  id: number;
  baseX: number;
  baseY: number;
  x: number;
  y: number;
}

const wrapAngle = (a: number) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));
// Fine control near center, full authority at the rim
const expo = (v: number) => v * (0.45 + 0.55 * v * v);

function axisDeadzone(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * Math.min(1, (a - DEADZONE) / (1 - DEADZONE));
}

export class TouchControls {
  mode: ControlMode;
  // Smoothed output axes, [-1, 1]
  fwd = 0;
  turn = 0;

  // stick/point use `move` only; dual maps left half → move, right → turn
  private move: Finger | null = null;
  private steer: Finger | null = null;

  private readonly stick = document.getElementById('stick')!;
  private readonly stickKnob = document.getElementById('stick-knob')!;
  private readonly stick2 = document.getElementById('stick2')!;
  private readonly stick2Knob = document.getElementById('stick2-knob')!;
  private readonly btn = document.getElementById('ctl-btn') as HTMLButtonElement;
  private readonly toast = document.getElementById('ctl-toast')!;
  private readonly help = document.getElementById('help');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly coarse = window.matchMedia('(pointer: coarse)').matches;

  constructor(canvas: HTMLCanvasElement, private enabled: () => boolean) {
    const stored = localStorage.getItem(STORE_KEY) as ControlMode | null;
    this.mode = stored && MODES.includes(stored) ? stored : 'stick';

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.enabled()) return;
      const finger: Finger = {
        id: e.pointerId,
        baseX: e.clientX,
        baseY: e.clientY,
        x: e.clientX,
        y: e.clientY,
      };
      if (this.mode === 'dual') {
        const left = e.clientX < window.innerWidth / 2;
        if (left && !this.move) this.move = finger;
        else if (!left && !this.steer) this.steer = finger;
        else return;
      } else {
        if (this.move) return;
        this.move = finger;
      }
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const f =
        this.move?.id === e.pointerId ? this.move : this.steer?.id === e.pointerId ? this.steer : null;
      if (!f) return;
      f.x = e.clientX;
      f.y = e.clientY;
      // Base follows the thumb past the rim: deflection stays saturated
      // but direction reversals bite immediately
      const dx = f.x - f.baseX;
      const dy = f.y - f.baseY;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        f.baseX += (dx / len) * (len - RADIUS);
        f.baseY += (dy / len) * (len - RADIUS);
      }
    });
    const end = (e: PointerEvent) => {
      if (this.move?.id === e.pointerId) this.move = null;
      if (this.steer?.id === e.pointerId) this.steer = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    this.btn.addEventListener('click', () => this.cycleMode());
    if (this.coarse) {
      this.btn.classList.remove('hidden');
      this.applyModeUI(false);
    }
  }

  get active(): boolean {
    return (
      this.move !== null ||
      this.steer !== null ||
      Math.abs(this.fwd) + Math.abs(this.turn) > 0.02
    );
  }

  cycleMode() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    localStorage.setItem(STORE_KEY, this.mode);
    this.move = null;
    this.steer = null;
    this.applyModeUI(true);
  }

  setMode(mode: ControlMode) {
    if (!MODES.includes(mode)) return;
    this.mode = mode;
    localStorage.setItem(STORE_KEY, mode);
    this.move = null;
    this.steer = null;
    this.applyModeUI(false);
  }

  private applyModeUI(withToast: boolean) {
    const meta = MODE_META[this.mode];
    this.btn.textContent = meta.icon;
    if (this.coarse && this.help) this.help.innerHTML = meta.help + HELP_SUFFIX;
    if (!withToast) return;
    this.toast.innerHTML = `${meta.icon} <b>${meta.name}</b> — ${meta.help.replaceAll('&nbsp;', ' ')}`;
    this.toast.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.add('hidden'), 2200);
  }

  // Radial-deadzoned deflection in [-1, 1] per axis (screen space)
  private deflect(f: Finger): { dx: number; dy: number; mag: number } {
    const dx = (f.x - f.baseX) / RADIUS;
    const dy = (f.y - f.baseY) / RADIUS;
    const len = Math.hypot(dx, dy);
    if (len < DEADZONE) return { dx: 0, dy: 0, mag: 0 };
    const mag = Math.min(1, (len - DEADZONE) / (1 - DEADZONE));
    return { dx: (dx / len) * mag, dy: (dy / len) * mag, mag };
  }

  // Compute this frame's axes. heading/camYaw feed the 'point' scheme;
  // driving switches its mapping from walker to vehicle.
  sample(dt: number, heading: number, camYaw: number, driving: boolean): void {
    let fwdT = 0;
    let turnT = 0;

    if (this.mode === 'dual') {
      if (this.move) fwdT = axisDeadzone(-(this.move.y - this.move.baseY) / RADIUS);
      if (this.steer) turnT = expo(axisDeadzone(-(this.steer.x - this.steer.baseX) / RADIUS));
    } else if (this.move) {
      const d = this.deflect(this.move);
      if (this.mode === 'stick') {
        fwdT = -d.dy;
        turnT = expo(-d.dx);
      } else if (d.mag > 0) {
        // point: thumb direction is camera-relative; steer toward it
        const desired = camYaw + Math.atan2(d.dx, -d.dy);
        const diff = wrapAngle(desired - heading);
        if (!driving) {
          turnT = clamp1(diff * 2.2);
          // Keep shuffling while swinging around — never fully stalls
          fwdT = d.mag * Math.max(0.3, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
        } else if (Math.abs(diff) < 1.75) {
          fwdT = d.mag * Math.max(0.35, Math.cos(diff));
          turnT = clamp1(diff * 1.6);
        } else {
          // Target behind the RV: back up, nose swinging toward it
          // (reverse flips steering, hence the sign)
          fwdT = -0.65 * d.mag;
          turnT = -Math.sign(diff);
        }
      }
    }

    const k = 1 - Math.exp(-dt / SMOOTH_TAU);
    this.fwd += (fwdT - this.fwd) * k;
    this.turn += (turnT - this.turn) * k;
    if (Math.abs(this.fwd) < 0.01 && fwdT === 0) this.fwd = 0;
    if (Math.abs(this.turn) < 0.01 && turnT === 0) this.turn = 0;

    this.updateStickDOM(this.stick, this.stickKnob, this.move, this.mode === 'dual' ? 'v' : 'xy');
    this.updateStickDOM(this.stick2, this.stick2Knob, this.mode === 'dual' ? this.steer : null, 'h');
  }

  private updateStickDOM(
    base: HTMLElement,
    knob: HTMLElement,
    f: Finger | null,
    axis: 'xy' | 'v' | 'h',
  ) {
    if (!f) {
      base.classList.add('hidden');
      return;
    }
    base.classList.remove('hidden');
    base.style.left = `${f.baseX}px`;
    base.style.top = `${f.baseY}px`;
    let dx = f.x - f.baseX;
    let dy = f.y - f.baseY;
    if (axis === 'v') dx = 0;
    if (axis === 'h') dy = 0;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx *= RADIUS / len;
      dy *= RADIUS / len;
    }
    knob.style.transform = `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`;
  }
}
