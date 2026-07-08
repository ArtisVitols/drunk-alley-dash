// Mobile touch controls: one floating joystick. Drag anywhere on the
// canvas — up walks / accelerates, sideways turns. The conditioning
// pipeline matters more than the scheme: a radial deadzone (thumbs
// never rest perfectly centered), an expo curve on the turn axis (fine
// steering near center, full rate at the edge), per-frame smoothing
// toward the target axes (kills pointer-event jitter), and a joystick
// base that follows the thumb when it overshoots the ring, so
// reversing direction responds instantly instead of after a long drag.

const RADIUS = 70; // px of thumb travel for full deflection
const DEADZONE = 0.14;
const SMOOTH_TAU = 0.075; // seconds to ~63% of a step change

interface Finger {
  id: number;
  baseX: number;
  baseY: number;
  x: number;
  y: number;
}

// Fine control near center, full authority at the rim
const expo = (v: number) => v * (0.45 + 0.55 * v * v);

export class TouchControls {
  // Smoothed output axes, [-1, 1]
  fwd = 0;
  turn = 0;

  private move: Finger | null = null;

  private readonly stick = document.getElementById('stick')!;
  private readonly stickKnob = document.getElementById('stick-knob')!;

  constructor(canvas: HTMLCanvasElement, private enabled: () => boolean) {
    // Phone-appropriate help line replaces the keyboard one
    if (window.matchMedia('(pointer: coarse)').matches) {
      const help = document.getElementById('help');
      if (help) {
        help.innerHTML =
          'Drag anywhere: up walks, sideways turns &nbsp;·&nbsp; 🏏 whacks bums &nbsp; 🚗 for cars ' +
          '&nbsp; stand at junk to clear &nbsp;·&nbsp; 🍺 +1 🍷 +2 🥃 +3';
      }
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.enabled() || this.move) return;
      this.move = {
        id: e.pointerId,
        baseX: e.clientX,
        baseY: e.clientY,
        x: e.clientX,
        y: e.clientY,
      };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const f = this.move;
      if (!f || f.id !== e.pointerId) return;
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
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  get active(): boolean {
    return this.move !== null || Math.abs(this.fwd) + Math.abs(this.turn) > 0.02;
  }

  // Radial-deadzoned deflection in [-1, 1] per axis (screen space)
  private deflect(f: Finger): { dx: number; dy: number } {
    const dx = (f.x - f.baseX) / RADIUS;
    const dy = (f.y - f.baseY) / RADIUS;
    const len = Math.hypot(dx, dy);
    if (len < DEADZONE) return { dx: 0, dy: 0 };
    const mag = Math.min(1, (len - DEADZONE) / (1 - DEADZONE));
    return { dx: (dx / len) * mag, dy: (dy / len) * mag };
  }

  sample(dt: number): void {
    let fwdT = 0;
    let turnT = 0;
    if (this.move) {
      const d = this.deflect(this.move);
      fwdT = -d.dy;
      turnT = expo(-d.dx);
    }

    const k = 1 - Math.exp(-dt / SMOOTH_TAU);
    this.fwd += (fwdT - this.fwd) * k;
    this.turn += (turnT - this.turn) * k;
    if (Math.abs(this.fwd) < 0.01 && fwdT === 0) this.fwd = 0;
    if (Math.abs(this.turn) < 0.01 && turnT === 0) this.turn = 0;

    this.updateStickDOM();
  }

  private updateStickDOM() {
    const f = this.move;
    if (!f) {
      this.stick.classList.add('hidden');
      return;
    }
    this.stick.classList.remove('hidden');
    this.stick.style.left = `${f.baseX}px`;
    this.stick.style.top = `${f.baseY}px`;
    let dx = f.x - f.baseX;
    let dy = f.y - f.baseY;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx *= RADIUS / len;
      dy *= RADIUS / len;
    }
    this.stickKnob.style.transform = `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`;
  }
}
