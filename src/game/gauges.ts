// RV dashboard: canvas-drawn speedometer and tachometer shown while
// aboard. Values are smoothed here so needles swing like real ones.

interface Dial {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  max: number;
  redline: number | null;
  label: string;
  ticks: number;
  value: number; // smoothed
}

function makeDial(id: string, max: number, ticks: number, label: string, redline: number | null): Dial {
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  return { canvas, ctx: canvas.getContext('2d')!, max, redline, label, ticks, value: 0 };
}

const START = Math.PI * 0.75; // dial sweeps 270°
const SWEEP = Math.PI * 1.5;

function draw(dial: Dial) {
  const { ctx, canvas } = dial;
  const w = canvas.width;
  const c = w / 2;
  const r = c - 6;
  ctx.clearRect(0, 0, w, w);

  // face
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12, 12, 20, 0.85)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 176, 102, 0.55)';
  ctx.stroke();

  // redline arc
  if (dial.redline !== null) {
    ctx.beginPath();
    ctx.arc(c, c, r - 7, START + SWEEP * (dial.redline / dial.max), START + SWEEP);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(217, 83, 79, 0.8)';
    ctx.stroke();
  }

  // ticks + numbers
  ctx.font = `${w * 0.09}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= dial.ticks; i++) {
    const frac = i / dial.ticks;
    const a = START + SWEEP * frac;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(c + cos * (r - 4), c + sin * (r - 4));
    ctx.lineTo(c + cos * (r - 12), c + sin * (r - 12));
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#cfc8b8';
    ctx.stroke();
    ctx.fillStyle = '#cfc8b8';
    ctx.fillText(
      String(Math.round(dial.max * frac)),
      c + cos * (r - 24),
      c + sin * (r - 24),
    );
  }

  // label
  ctx.fillStyle = '#8f8878';
  ctx.font = `${w * 0.085}px ui-monospace, monospace`;
  ctx.fillText(dial.label, c, c + r * 0.28);

  // needle
  const frac = Math.min(1, Math.max(0, dial.value / dial.max));
  const a = START + SWEEP * frac;
  ctx.beginPath();
  ctx.moveTo(c - Math.cos(a) * 8, c - Math.sin(a) * 8);
  ctx.lineTo(c + Math.cos(a) * (r - 16), c + Math.sin(a) * (r - 16));
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffb066';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd9ad';
  ctx.fill();
}

export class Gauges {
  private wrap = document.getElementById('gauges')!;
  private speedo = makeDial('speedo', 60, 6, 'km/h', null);
  private tacho = makeDial('tacho', 6, 6, 'rpm ×1000', 4.5);
  private visible = false;

  // speed in m/s; throttle 0..1
  update(dt: number, aboard: boolean, speed: number, throttle: number) {
    if (aboard !== this.visible) {
      this.visible = aboard;
      this.wrap.classList.toggle('hidden', !aboard);
    }
    if (!aboard) return;
    const k = 1 - Math.pow(0.002, dt);
    this.speedo.value += (Math.abs(speed) * 3.6 - this.speedo.value) * k;
    // Fake RPM: idle 0.8k, climbs with speed, blips with throttle
    const rpm = 0.8 + (Math.abs(speed) / 11.5) * 3.4 + throttle * 0.8;
    this.tacho.value += (rpm - this.tacho.value) * k;
    draw(this.speedo);
    draw(this.tacho);
  }

  get rpm(): number {
    return this.tacho.value;
  }
}
