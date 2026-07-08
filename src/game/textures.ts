import * as THREE from 'three';

// All textures are generated on canvases so the game stays fully
// self-contained (no asset downloads).

function makeCanvas(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function toTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number, srgb = true) {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

// The color canvas doubles as a bump map (dark = recessed): mortar
// lines, cracks and window holes read as real depth under raking light.
function toBump(canvas: HTMLCanvasElement, repeatX: number, repeatY: number) {
  return toTexture(canvas, repeatX, repeatY, false);
}

// Cheap baked AO: darken the canvas edges so surfaces ground
// themselves where they meet roofs/streets/corners.
function edgeAO(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.35) {
  const m = Math.round(Math.min(w, h) * 0.08);
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, 0, 0, m, 0, 0, w, m], // top
    [0, h, 0, h - m, 0, h - m, w, m], // bottom
    [0, 0, m, 0, 0, 0, m, h], // left
    [w, 0, w - m, 0, w - m, 0, m, h], // right
  ] as const) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  }
}

export function asphaltTextures(repeatX: number, repeatY: number) {
  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = '#26262d';
  ctx.fillRect(0, 0, 512, 512);

  // Gravel speckle
  for (let i = 0; i < 5000; i++) {
    const v = 20 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v},${v},${v + 6},${0.25 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // Oil stains and grime blotches
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 25 + Math.random() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(8,8,12,${0.25 + Math.random() * 0.3})`);
    g.addColorStop(1, 'rgba(8,8,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Cracks
  ctx.strokeStyle = 'rgba(10,10,14,0.5)';
  for (let i = 0; i < 10; i++) {
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      x += (Math.random() - 0.5) * 90;
      y += (Math.random() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Worn tire tracks — two darker soft bands (the texture tiles, so
  // they read as traffic lanes wherever it repeats)
  for (const bx of [140, 340]) {
    const g = ctx.createLinearGradient(bx - 35, 0, bx + 35, 0);
    g.addColorStop(0, 'rgba(12,12,16,0)');
    g.addColorStop(0.5, 'rgba(12,12,16,0.22)');
    g.addColorStop(1, 'rgba(12,12,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(bx - 35, 0, 70, 512);
  }

  // A manhole cover and a drain grate per tile
  {
    const mx = 80 + Math.random() * 350;
    const my = 80 + Math.random() * 350;
    ctx.fillStyle = '#17171c';
    ctx.beginPath();
    ctx.arc(mx, my, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2e2e36';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.stroke();

    const gx = 80 + Math.random() * 350;
    const gy = 80 + Math.random() * 350;
    ctx.fillStyle = '#131318';
    ctx.fillRect(gx, gy, 46, 26);
    ctx.fillStyle = '#2a2a32';
    for (let b = 0; b < 5; b++) ctx.fillRect(gx + 4 + b * 9, gy + 3, 4, 20);
  }

  return {
    map: toTexture(canvas, repeatX, repeatY),
    bumpMap: toBump(canvas, repeatX, repeatY),
  };
}

export function brickTexture(repeatX: number, repeatY: number, hue: number, sat: number, light: number) {
  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = '#1c1a18'; // mortar
  ctx.fillRect(0, 0, 512, 512);

  const bh = 32;
  const bw = 64;
  for (let row = 0; row < 512 / bh; row++) {
    const offset = row % 2 === 0 ? 0 : bw / 2;
    for (let col = -1; col < 512 / bw + 1; col++) {
      const l = light + (Math.random() - 0.5) * 9;
      ctx.fillStyle = `hsl(${hue + (Math.random() - 0.5) * 8}, ${sat}%, ${l}%)`;
      ctx.fillRect(col * bw + offset + 2, row * bh + 2, bw - 4, bh - 4);
    }
  }

  // Grime wash from the bottom up (bottom of texture = street level)
  const grime = ctx.createLinearGradient(0, 0, 0, 512);
  grime.addColorStop(0, 'rgba(5,5,8,0.15)');
  grime.addColorStop(0.65, 'rgba(5,5,8,0.25)');
  grime.addColorStop(1, 'rgba(5,5,8,0.7)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, 512, 512);

  // Random stains
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 30 + Math.random() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(12,10,8,${0.2 + Math.random() * 0.25})`);
    g.addColorStop(1, 'rgba(12,10,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  edgeAO(ctx, 512, 512, 0.3);
  return { map: toTexture(canvas, repeatX, repeatY), bumpMap: toBump(canvas, repeatX, repeatY) };
}

// Vertical sky gradient, mapped onto an inside-out dome.
export function skyTexture(stops: [number, string][]) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Soft cumulus blob for cloud sprites.
export function cloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 14; i++) {
    const x = 40 + Math.random() * 176;
    const y = 45 + Math.random() * 45;
    const r = 22 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Sun or moon: bright disc with a soft halo.
export function celestialTexture(core: string, halo: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, core);
  g.addColorStop(0.32, core);
  g.addColorStop(0.45, halo);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Sandy country road: warm beige base with grit and dark tire tracks
// running along the V axis (the road ribbon maps V along its length).
export function sandTextures(repeatX: number, repeatY: number) {
  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = '#c9ab72';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4500; i++) {
    const v = 140 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v},${v * 0.85},${v * 0.55},${0.2 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // Twin tire tracks with wobble
  for (const cx of [160, 352]) {
    ctx.strokeStyle = 'rgba(90,70,40,0.5)';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(cx, -10);
    for (let y = 0; y <= 512; y += 32) {
      ctx.lineTo(cx + Math.sin(y * 0.05) * 8 + (Math.random() - 0.5) * 6, y);
    }
    ctx.stroke();
  }
  // Scattered pebbles
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(110,95,70,${0.4 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return {
    map: toTexture(canvas, repeatX, repeatY),
    bumpMap: toTexture(canvas, repeatX, repeatY, false),
  };
}

// Countryside grass: layered green noise with lighter blade flecks.
export function grassTexture(repeatX: number, repeatY: number) {
  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = '#4d7a38';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) {
    const g = 100 + Math.random() * 70;
    ctx.fillStyle = `rgba(${g * 0.45},${g},${g * 0.35},${0.25 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 2 + Math.random() * 3);
  }
  // Dry patches
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 30 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(150,140,80,0.25)');
    g.addColorStop(1, 'rgba(150,140,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return { map: toTexture(canvas, repeatX, repeatY), bumpMap: toBump(canvas, repeatX, repeatY) };
}

// Green highway sign, white border and text — the ROUTE 65 banner.
export function signTexture(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a6b34';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#f2f0e8';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 140);
  ctx.font = '900 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2f0e8';
  ctx.fillText(text, 256, 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// City building facade: plaster/brick base with a grid of windows —
// sills, occasional balconies, roofline stain streaks. At night a
// fraction of windows glow warm. 1024² (only ~6 of these exist).
export function facadeTexture(hue: number, sat: number, light: number, litProb: number) {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S);
  ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
  ctx.fillRect(0, 0, S, S);

  // Weathering blotches
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 60 + Math.random() * 180;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(20,16,12,${0.08 + Math.random() * 0.14})`);
    g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Roofline rust/water stain streaks running down from the top
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * S;
    const len = 120 + Math.random() * 300;
    const w = 6 + Math.random() * 18;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(48,36,24,${0.18 + Math.random() * 0.15})`);
    g.addColorStop(1, 'rgba(48,36,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, len);
  }

  // Window grid
  const cols = 6;
  const rows = 7;
  const cw = S / cols;
  const ch = S / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const wx = col * cw + cw * 0.22;
      const wy = row * ch + ch * 0.2;
      const ww = cw * 0.56;
      const wh = ch * 0.58;
      // frame
      ctx.fillStyle = 'rgba(30,26,22,0.9)';
      ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
      const lit = Math.random() < litProb;
      if (lit) {
        // Varied warmth: some lamps golden, some pale, some dim TV-blue
        const roll = Math.random();
        ctx.fillStyle =
          roll < 0.6
            ? `hsl(${38 + Math.random() * 14}, 75%, ${52 + Math.random() * 14}%)`
            : roll < 0.85
              ? `hsl(${30 + Math.random() * 10}, 55%, ${40 + Math.random() * 10}%)`
              : `hsl(215, 45%, ${45 + Math.random() * 12}%)`;
      } else {
        ctx.fillStyle = `hsl(220, 18%, ${8 + Math.random() * 9}%)`;
      }
      ctx.fillRect(wx, wy, ww, wh);
      if (!lit) {
        // sky glint on dead glass
        ctx.fillStyle = 'rgba(160,180,210,0.18)';
        ctx.fillRect(wx, wy, ww, wh * 0.28);
        // half-drawn curtain now and then
        if (Math.random() < 0.3) {
          ctx.fillStyle = `hsl(${20 + Math.random() * 30}, 25%, 30%)`;
          ctx.fillRect(wx, wy, ww, wh * (0.2 + Math.random() * 0.3));
        }
      } else {
        // window cross bar
        ctx.fillStyle = 'rgba(30,26,22,0.8)';
        ctx.fillRect(wx + ww / 2 - 3, wy, 6, wh);
      }
      // Sill: light top edge + shadow beneath (reads as depth)
      ctx.fillStyle = `hsl(${hue}, ${Math.max(0, sat - 12)}%, ${Math.min(90, light + 18)}%)`;
      ctx.fillRect(wx - 10, wy + wh + 6, ww + 20, 7);
      ctx.fillStyle = 'rgba(10,8,6,0.4)';
      ctx.fillRect(wx - 10, wy + wh + 13, ww + 20, 9);
      // Streak of grime under some sills
      if (Math.random() < 0.4) {
        const g = ctx.createLinearGradient(0, wy + wh + 20, 0, wy + wh + 70);
        g.addColorStop(0, 'rgba(25,20,15,0.3)');
        g.addColorStop(1, 'rgba(25,20,15,0)');
        ctx.fillStyle = g;
        ctx.fillRect(wx - 4, wy + wh + 20, ww + 8, 50);
      }
    }
    // A balcony strip on some middle floors: railing bars over the sill line
    if (row > 0 && row < rows - 2 && Math.random() < 0.35) {
      const by = row * ch + ch * 0.82;
      const bx = Math.floor(Math.random() * (cols - 1)) * cw + cw * 0.1;
      ctx.fillStyle = 'rgba(20,18,16,0.85)';
      ctx.fillRect(bx, by, cw * 0.8, 6);
      for (let b = 0; b < 10; b++) {
        ctx.fillRect(bx + b * (cw * 0.8 / 9), by - 26, 4, 26);
      }
      ctx.fillRect(bx, by - 30, cw * 0.8, 5);
    }
  }

  // Street-level grime
  const grime = ctx.createLinearGradient(0, S * 0.74, 0, S);
  grime.addColorStop(0, 'rgba(8,8,10,0)');
  grime.addColorStop(1, 'rgba(8,8,10,0.55)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, S * 0.74, S, S * 0.26);

  edgeAO(ctx, S, S, 0.35);
  return { map: toTexture(canvas, 1, 1), bumpMap: toBump(canvas, 1, 1) };
}

// Distant city skyline silhouette — a long strip of dark rooftops with
// pinprick lit windows (night) mapped onto a ring of planes behind the
// buildings. 1024×256, one per scene.
export function skylineTexture(night: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 256);
  let x = 0;
  while (x < 1024) {
    const w = 30 + Math.random() * 70;
    const h = 60 + Math.random() * 150;
    // Day silhouettes sit in atmospheric haze — pale blue-grey, barely
    // darker than the sky, so they read as distance instead of panels
    const shade = night ? 6 + Math.random() * 6 : 58 + Math.random() * 8;
    ctx.fillStyle = `hsl(222, ${night ? 20 : 16}%, ${shade}%)`;
    ctx.fillRect(x, 256 - h, w, h);
    // occasional chimney / antenna
    if (Math.random() < 0.4) {
      ctx.fillRect(x + w * 0.2 + Math.random() * w * 0.5, 256 - h - 14, 5, 14);
    }
    // haze veil over the lower half so rooftops fade toward the ground
    if (!night) {
      const veil = ctx.createLinearGradient(0, 256 - h, 0, 256);
      veil.addColorStop(0, 'rgba(190,205,225,0)');
      veil.addColorStop(1, 'rgba(190,205,225,0.55)');
      ctx.fillStyle = veil;
      ctx.fillRect(x, 256 - h, w, h);
    }
    if (night) {
      // pinprick lit windows
      for (let wy = 256 - h + 8; wy < 248; wy += 12) {
        for (let wx = x + 4; wx < x + w - 4; wx += 10) {
          if (Math.random() < 0.13) {
            ctx.fillStyle = `hsla(${35 + Math.random() * 15}, 80%, 60%, ${0.5 + Math.random() * 0.5})`;
            ctx.fillRect(wx, wy, 3, 4);
            ctx.fillStyle = `hsl(225, 20%, ${shade}%)`;
          }
        }
      }
    }
    x += w + Math.random() * 24;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// Tall-grass / wildflower tuft on a transparent card, used alpha-tested
// on merged cross-planes in the countryside.
export function tuftTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) {
    const bx = 20 + Math.random() * 88;
    const lean = (Math.random() - 0.5) * 40;
    const h = 50 + Math.random() * 70;
    const g = 30 + Math.random() * 35;
    ctx.strokeStyle = `hsl(${85 + Math.random() * 30}, ${40 + Math.random() * 20}%, ${g}%)`;
    ctx.lineWidth = 2 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(bx, 128);
    ctx.quadraticCurveTo(bx + lean * 0.3, 128 - h * 0.6, bx + lean, 128 - h);
    ctx.stroke();
  }
  // A few flower heads
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = ['#e8d44f', '#d8dde2', '#c47ab8'][Math.floor(Math.random() * 3)];
    ctx.beginPath();
    ctx.arc(24 + Math.random() * 80, 30 + Math.random() * 40, 3 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Roadside billboard ad — weathered Lithuanian advertising.
export function billboardTexture(lines: string[], bg: string, fg: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 240);
  ctx.textAlign = 'center';
  ctx.fillStyle = fg;
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? '900 64px system-ui, sans-serif' : 'italic 600 34px system-ui, sans-serif';
    ctx.fillText(line, 256, 100 + i * 70);
  });
  // Weathering: streaks + a peeled corner
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * 512;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, `rgba(30,24,18,${0.1 + Math.random() * 0.15})`);
    g.addColorStop(1, 'rgba(30,24,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 10 + Math.random() * 20, 256);
  }
  ctx.fillStyle = '#5c5248';
  ctx.beginPath();
  ctx.moveTo(512, 200);
  ctx.lineTo(512, 256);
  ctx.lineTo(448, 256);
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Shared car-paint wear layer: white base (tinted by material.color)
// with bottom-up road grime, faint scratches and dings. One 256² canvas
// serves every vehicle.
let paintCache: THREE.Texture | null = null;
export function carPaintTexture() {
  if (paintCache) return paintCache;
  const { canvas, ctx } = makeCanvas(256);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 256);
  // Road grime creeping up from the rocker panels
  const grime = ctx.createLinearGradient(0, 150, 0, 256);
  grime.addColorStop(0, 'rgba(60,52,40,0)');
  grime.addColorStop(1, 'rgba(60,52,40,0.5)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 150, 256, 106);
  // Faint scratches
  ctx.strokeStyle = 'rgba(230,230,235,0.35)';
  for (let i = 0; i < 8; i++) {
    ctx.lineWidth = 0.6 + Math.random();
    ctx.beginPath();
    const y = Math.random() * 256;
    ctx.moveTo(Math.random() * 100, y);
    ctx.lineTo(120 + Math.random() * 136, y + (Math.random() - 0.5) * 22);
    ctx.stroke();
  }
  // Dings and rust spots
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(${90 + Math.random() * 40},${60 + Math.random() * 25},35,${0.15 + Math.random() * 0.25})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 1.5 + Math.random() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  paintCache = toTexture(canvas, 1, 1);
  return paintCache;
}

// Lithuanian license plate: blue EU strip, black text on white.
export function plateTexture(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 128, 32);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 126, 30);
  ctx.fillStyle = '#003399';
  ctx.fillRect(0, 0, 18, 32);
  ctx.fillStyle = '#ffcc00';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('LT', 4, 28);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '900 20px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 74, 17);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function neonTexture(text: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 192);
  ctx.font = '900 110px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Layered glow
  ctx.shadowColor = color;
  for (const blur of [45, 25, 10]) {
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeText(text, 256, 96);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 96);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
