// Mobile touch controls: one FIXED joystick anchored on the right side
// of the screen, above the car button — always visible during play, so
// the thumb always knows where home is. Up walks / accelerates,
// sideways turns. The conditioning pipeline: a radial deadzone (thumbs
// never rest perfectly centered), an expo curve on the turn axis (fine
// steering near center, full rate at the edge), and per-frame smoothing
// toward the target axes (kills pointer-event jitter).

const RADIUS = 62; // px of thumb travel for full deflection
const GRAB_RADIUS = 130; // touches starting this close to center grab the stick
const DEADZONE = 0.14;
const SMOOTH_TAU = 0.075; // seconds to ~63% of a step change

// Fine control near center, full authority at the rim
const expo = (v: number) => v * (0.45 + 0.55 * v * v);

export class TouchControls {
  // Smoothed output axes, [-1, 1]
  fwd = 0;
  turn = 0;

  private pointerId: number | null = null;
  private touchX = 0;
  private touchY = 0;

  // Any OTHER touch (typically the left thumb) swipes the camera:
  // horizontal drag accumulates here and main.ts consumes it per frame
  private camId: number | null = null;
  private camLastX = 0;
  private camDx = 0;

  private readonly stick = document.getElementById('stick')!;
  private readonly stickKnob = document.getElementById('stick-knob')!;
  private readonly coarse = window.matchMedia('(pointer: coarse)').matches;

  constructor(canvas: HTMLCanvasElement, private enabled: () => boolean) {
    // Phone-appropriate help line replaces the keyboard one
    if (this.coarse) {
      const help = document.getElementById('help');
      if (help) {
        help.innerHTML =
          'Right stick moves &nbsp; swipe anywhere else to look around &nbsp;·&nbsp; 🏏 whacks bums ' +
          '&nbsp; 🚗 for cars &nbsp; stand at junk to clear &nbsp;·&nbsp; 🍺 +1 🍷 +2 🥃 +3';
      }
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !this.enabled()) return;
      const c = this.center();
      const onStick = Math.hypot(e.clientX - c.x, e.clientY - c.y) <= GRAB_RADIUS;
      if (onStick && this.pointerId === null) {
        this.pointerId = e.pointerId;
        this.touchX = e.clientX;
        this.touchY = e.clientY;
      } else if (!onStick && this.camId === null) {
        // Everywhere else: this finger looks around
        this.camId = e.pointerId;
        this.camLastX = e.clientX;
      } else {
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointerId === e.pointerId) {
        this.touchX = e.clientX;
        this.touchY = e.clientY;
      } else if (this.camId === e.pointerId) {
        this.camDx += e.clientX - this.camLastX;
        this.camLastX = e.clientX;
      }
    });
    const end = (e: PointerEvent) => {
      if (this.pointerId === e.pointerId) this.pointerId = null;
      if (this.camId === e.pointerId) this.camId = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private center(): { x: number; y: number } {
    const rect = this.stick.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  get active(): boolean {
    return this.pointerId !== null || Math.abs(this.fwd) + Math.abs(this.turn) > 0.02;
  }

  // Horizontal camera-swipe pixels since the last call (consumed)
  takeCamSwipe(): number {
    const dx = this.camDx;
    this.camDx = 0;
    return dx;
  }

  // True while a finger is holding the camera (blocks auto-recenter)
  get lookHeld(): boolean {
    return this.camId !== null;
  }

  sample(dt: number): void {
    // The ring lives on screen whenever a coarse-pointer player is in
    // the game — it never pops in and out with touches
    this.stick.classList.toggle('hidden', !this.coarse || !this.enabled());

    let fwdT = 0;
    let turnT = 0;
    let knobX = 0;
    let knobY = 0;
    if (this.pointerId !== null) {
      const c = this.center();
      const rx = (this.touchX - c.x) / RADIUS;
      const ry = (this.touchY - c.y) / RADIUS;
      const len = Math.hypot(rx, ry);
      const clamped = Math.min(1, len);
      if (len > 1e-4) {
        knobX = (rx / len) * clamped;
        knobY = (ry / len) * clamped;
        if (len >= DEADZONE) {
          const mag = (clamped - DEADZONE) / (1 - DEADZONE);
          fwdT = -(ry / len) * mag;
          turnT = expo(-(rx / len) * mag);
        }
      }
    }

    const k = 1 - Math.exp(-dt / SMOOTH_TAU);
    this.fwd += (fwdT - this.fwd) * k;
    this.turn += (turnT - this.turn) * k;
    if (Math.abs(this.fwd) < 0.01 && fwdT === 0) this.fwd = 0;
    if (Math.abs(this.turn) < 0.01 && turnT === 0) this.turn = 0;

    this.stickKnob.style.transform = `translate(calc(${knobX * RADIUS}px - 50%), calc(${knobY * RADIUS}px - 50%))`;
  }
}
