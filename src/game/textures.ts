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

  return {
    map: toTexture(canvas, repeatX, repeatY),
    bumpMap: toTexture(canvas, repeatX, repeatY, false),
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

  return toTexture(canvas, repeatX, repeatY);
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
  return toTexture(canvas, repeatX, repeatY);
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

// City building facade: plaster/brick base with a grid of windows.
// At night a fraction of windows glow warm.
export function facadeTexture(hue: number, sat: number, light: number, litProb: number) {
  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
  ctx.fillRect(0, 0, 512, 512);

  // Weathering blotches
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const r = 30 + Math.random() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(20,16,12,${0.08 + Math.random() * 0.14})`);
    g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Window grid
  const cols = 6;
  const rows = 7;
  const cw = 512 / cols;
  const ch = 512 / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const wx = col * cw + cw * 0.22;
      const wy = row * ch + ch * 0.2;
      const ww = cw * 0.56;
      const wh = ch * 0.58;
      // frame
      ctx.fillStyle = 'rgba(30,26,22,0.9)';
      ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      const lit = Math.random() < litProb;
      ctx.fillStyle = lit
        ? `hsl(${38 + Math.random() * 14}, 75%, ${52 + Math.random() * 14}%)`
        : `hsl(220, 18%, ${8 + Math.random() * 9}%)`;
      ctx.fillRect(wx, wy, ww, wh);
      if (!lit) {
        // sky glint on dead glass
        ctx.fillStyle = 'rgba(160,180,210,0.18)';
        ctx.fillRect(wx, wy, ww, wh * 0.28);
      }
    }
  }

  // Street-level grime
  const grime = ctx.createLinearGradient(0, 380, 0, 512);
  grime.addColorStop(0, 'rgba(8,8,10,0)');
  grime.addColorStop(1, 'rgba(8,8,10,0.55)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 380, 512, 132);

  return toTexture(canvas, 1, 1);
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
