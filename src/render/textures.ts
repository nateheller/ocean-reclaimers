/**
 * Procedural, original artwork. Everything is drawn with the 2D canvas API at
 * runtime, so the game ships with no external image files or licences.
 */
import Phaser from 'phaser'
import { Rng } from '../core/rng'

/** Textures are drawn at 2x so they stay crisp on high-DPI screens. */
export const TS = 2

type Ctx = CanvasRenderingContext2D

export function mk(scene: Phaser.Scene, key: string, w: number, h: number, fn: (ctx: Ctx, w: number, h: number) => void): void {
  const c = document.createElement('canvas')
  c.width = Math.ceil(w * TS)
  c.height = Math.ceil(h * TS)
  const ctx = c.getContext('2d')!
  ctx.scale(TS, TS)
  fn(ctx, w, h)
  if (scene.textures.exists(key)) scene.textures.remove(key)
  scene.textures.addCanvas(key, c)
}

function mkRaw(scene: Phaser.Scene, key: string, size: number, fn: (data: ImageData) => void): void {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  fn(img)
  ctx.putImageData(img, 0, 0)
  if (scene.textures.exists(key)) scene.textures.remove(key)
  scene.textures.addCanvas(key, c)
}

// ---------------------------------------------------------------------------
// Seamless water tiles
// ---------------------------------------------------------------------------

interface Wave {
  kx: number
  ky: number
  phase: number
  amp: number
}

function makeWaves(seed: number, count: number, minK: number, maxK: number): Wave[] {
  const rng = new Rng(seed)
  const waves: Wave[] = []
  for (let i = 0; i < count; i++) {
    const k = rng.int(minK, maxK)
    const a = rng.range(0, Math.PI * 2)
    waves.push({
      kx: Math.round(Math.cos(a) * k) || 1,
      ky: Math.round(Math.sin(a) * k) || 1,
      phase: rng.range(0, Math.PI * 2),
      amp: rng.range(0.6, 1),
    })
  }
  return waves
}

function field(waves: Wave[], x: number, y: number, size: number): number {
  let v = 0
  let total = 0
  for (const w of waves) {
    v += w.amp * Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase)
    total += w.amp
  }
  return v / total
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t

function buildWater(scene: Phaser.Scene): void {
  const size = 512
  const low = makeWaves(11, 6, 1, 3)
  const mid = makeWaves(23, 5, 3, 6)
  mkRaw(scene, 'water_base', size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = field(low, x, y, size) * 0.7 + field(mid, x, y, size) * 0.3
        const t = 0.5 + 0.5 * v
        const i = (y * size + x) * 4
        img.data[i] = mix(34, 70, t)
        img.data[i + 1] = mix(150, 205, t)
        img.data[i + 2] = mix(196, 228, t)
        img.data[i + 3] = 255
      }
    }
  })

  const c1 = makeWaves(37, 3, 2, 4)
  const c2 = makeWaves(53, 3, 3, 5)
  mkRaw(scene, 'water_caustic', size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = field(c1, x, y, size)
        const b = field(c2, x + 40, y + 90, size)
        const line = Math.pow(Math.max(0, 1 - Math.abs(a + b) * 2.2), 3)
        const i = (y * size + x) * 4
        img.data[i] = 255
        img.data[i + 1] = 255
        img.data[i + 2] = 255
        img.data[i + 3] = Math.min(255, line * 150)
      }
    }
  })

  const m1 = makeWaves(71, 5, 2, 5)
  const m2 = makeWaves(97, 4, 5, 9)
  mkRaw(scene, 'murk', size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = field(m1, x, y, size) * 0.65 + field(m2, x, y, size) * 0.35
        const t = 0.5 + 0.5 * v
        const i = (y * size + x) * 4
        img.data[i] = mix(76, 104, t)
        img.data[i + 1] = mix(96, 112, t)
        img.data[i + 2] = mix(58, 70, t)
        img.data[i + 3] = mix(150, 255, t)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Small shared sprites
// ---------------------------------------------------------------------------

function buildSprites(scene: Phaser.Scene): void {
  mk(scene, 'drop', 16, 16, (g) => {
    const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.8)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 16, 16)
  })
  mk(scene, 'foam', 32, 32, (g) => {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.55, 'rgba(235,252,255,0.55)')
    grad.addColorStop(1, 'rgba(235,252,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 32, 32)
  })
  mk(scene, 'ring', 128, 128, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.95)'
    g.lineWidth = 5
    g.beginPath()
    g.arc(64, 64, 58, 0, Math.PI * 2)
    g.stroke()
  })
  mk(scene, 'glow', 128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.4, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
  })
  mk(scene, 'blob', 64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30)
    grad.addColorStop(0, 'rgba(0,40,70,0.55)')
    grad.addColorStop(0.7, 'rgba(0,40,70,0.25)')
    grad.addColorStop(1, 'rgba(0,40,70,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
  })
  mk(scene, 'coin', 24, 24, (g) => {
    g.fillStyle = '#b8780a'
    g.beginPath(); g.arc(12, 12, 10, 0, Math.PI * 2); g.fill()
    const grad = g.createLinearGradient(4, 4, 20, 20)
    grad.addColorStop(0, '#fff3a6'); grad.addColorStop(1, '#ffb81c')
    g.fillStyle = grad
    g.beginPath(); g.arc(12, 12, 8.5, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#d98f0a'; g.lineWidth = 1.6
    g.beginPath(); g.arc(12, 12, 5.2, 0, Math.PI * 2); g.stroke()
  })
  mk(scene, 'spark', 24, 24, (g) => {
    g.fillStyle = '#fff'
    g.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const r = i % 2 === 0 ? 11 : 3
      g.lineTo(12 + Math.cos(a) * r, 12 + Math.sin(a) * r)
    }
    g.closePath(); g.fill()
  })
  mk(scene, 'buoy', 24, 24, (g) => {
    g.fillStyle = 'rgba(0,40,70,0.3)'; g.beginPath(); g.arc(13, 14, 9, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(12, 12, 9, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#ff4a3d'
    g.beginPath(); g.arc(12, 12, 9, 0.2, 1.4); g.lineTo(12, 12); g.fill()
    g.beginPath(); g.arc(12, 12, 9, Math.PI + 0.2, Math.PI + 1.4); g.lineTo(12, 12); g.fill()
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(12, 12, 3, 0, Math.PI * 2); g.fill()
    g.strokeStyle = '#a8c4d4'; g.lineWidth = 1.2; g.beginPath(); g.arc(12, 12, 9, 0, Math.PI * 2); g.stroke()
  })
}

// ---------------------------------------------------------------------------
// Debris
// ---------------------------------------------------------------------------

function buildDebris(scene: Phaser.Scene): void {
  // Plastic bottle (top-down, lying on its side, cap to the right).
  mk(scene, 'bottle', 36, 24, (g) => {
    g.save(); g.translate(18, 12)
    g.fillStyle = 'rgba(0,40,70,0.28)'
    g.beginPath(); g.ellipse(1.5, 2.5, 13, 5.6, 0, 0, Math.PI * 2); g.fill()
    const body = g.createLinearGradient(0, -6, 0, 6)
    body.addColorStop(0, '#e8f9ff'); body.addColorStop(0.5, '#a9e1fb'); body.addColorStop(1, '#6cbbe6')
    g.fillStyle = body; g.strokeStyle = '#ffffff'; g.lineWidth = 1.6
    g.beginPath()
    g.moveTo(-12, -4.6); g.quadraticCurveTo(-13.5, 0, -12, 4.6)
    g.lineTo(3, 5); g.quadraticCurveTo(8, 4.5, 10, 1.8); g.lineTo(10, -1.8)
    g.quadraticCurveTo(8, -4.5, 3, -5); g.closePath()
    g.fill(); g.stroke()
    g.fillStyle = '#2fbf71'; g.fillRect(-7, -5, 6, 10)
    g.fillStyle = '#ffffff'; g.fillRect(-5.5, -5, 1.6, 10)
    g.fillStyle = '#ff3d5a'; g.strokeStyle = '#b3122e'; g.lineWidth = 1
    g.beginPath(); g.roundRect(10, -2.6, 5, 5.2, 1.4); g.fill(); g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.85)'
    g.beginPath(); g.ellipse(-3, -3, 7, 1.1, 0, 0, Math.PI * 2); g.fill()
    g.restore()
  })

  // Plastic container (orange crate with a carry handle).
  mk(scene, 'container', 44, 44, (g) => {
    g.save(); g.translate(22, 22)
    g.fillStyle = 'rgba(0,40,70,0.28)'
    g.beginPath(); g.roundRect(-14, -11, 30, 25, 6); g.fill()
    const body = g.createLinearGradient(-15, -13, 15, 13)
    body.addColorStop(0, '#ffc15a'); body.addColorStop(1, '#f07a1a')
    g.fillStyle = body; g.strokeStyle = '#a84a07'; g.lineWidth = 1.8
    g.beginPath(); g.roundRect(-15, -13, 30, 26, 6); g.fill(); g.stroke()
    g.fillStyle = '#c9590f'
    g.beginPath(); g.roundRect(-10.5, -8.5, 21, 17, 4); g.fill()
    g.fillStyle = '#ffd28a'
    g.beginPath(); g.roundRect(-8, -6, 16, 12, 3); g.fill()
    g.strokeStyle = '#ffffff'; g.globalAlpha = 0.85; g.lineWidth = 1.6
    g.beginPath(); g.moveTo(-12, -11); g.lineTo(12, -11); g.stroke()
    g.globalAlpha = 1
    g.fillStyle = '#7a3304'
    g.beginPath(); g.roundRect(-5, -1.6, 10, 3.2, 1.6); g.fill()
    g.restore()
  })

  // Fishing net (tangle of rope with floats).
  mk(scene, 'net', 72, 72, (g) => {
    g.save(); g.translate(36, 36)
    const blob = (r: number) => {
      g.beginPath()
      const pts = 11
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2
        const rr = r * (0.82 + 0.18 * Math.sin(i * 2.3 + 1))
        const x = Math.cos(a) * rr
        const y = Math.sin(a) * rr * 0.86
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.closePath()
    }
    g.fillStyle = 'rgba(0,40,70,0.25)'; g.save(); g.translate(2, 3); blob(26); g.fill(); g.restore()
    g.fillStyle = 'rgba(40,120,70,0.35)'; blob(26); g.fill()
    g.save(); blob(26); g.clip()
    g.strokeStyle = '#2f7d3a'; g.lineWidth = 3.4
    for (let i = -34; i <= 34; i += 9) {
      g.beginPath(); g.moveTo(i - 24, -30); g.lineTo(i + 24, 30); g.stroke()
      g.beginPath(); g.moveTo(i + 24, -30); g.lineTo(i - 24, 30); g.stroke()
    }
    g.strokeStyle = '#b8f26a'; g.lineWidth = 1.7
    for (let i = -34; i <= 34; i += 9) {
      g.beginPath(); g.moveTo(i - 24, -30); g.lineTo(i + 24, 30); g.stroke()
      g.beginPath(); g.moveTo(i + 24, -30); g.lineTo(i - 24, 30); g.stroke()
    }
    g.restore()
    g.strokeStyle = '#2f7d3a'; g.lineWidth = 3.6; blob(26); g.stroke()
    g.strokeStyle = '#d6ff8e'; g.lineWidth = 1.8; blob(26); g.stroke()
    const floats: [number, number][] = [[-22, -8], [10, -20], [22, 10], [-6, 19]]
    for (const [fx, fy] of floats) {
      g.fillStyle = '#ff4a3d'; g.strokeStyle = '#8f1a10'; g.lineWidth = 1.2
      g.beginPath(); g.arc(fx, fy, 4.6, 0, Math.PI * 2); g.fill(); g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(fx - 1.3, fy - 1.4, 1.4, 0, Math.PI * 2); g.fill()
    }
    g.restore()
  })
}

// ---------------------------------------------------------------------------
// The boat hull (faces +x; the center of the texture is the boat center)
// ---------------------------------------------------------------------------

function hullPath(g: Ctx, inset = 0): void {
  const i = inset
  g.beginPath()
  g.moveTo(-31 + i, -12 + i)
  g.lineTo(8, -13.5 + i)
  g.bezierCurveTo(22, -13.5 + i, 32, -6, 36 - i, 0)
  g.bezierCurveTo(32, 6, 22, 13.5 - i, 8, 13.5 - i)
  g.lineTo(-31 + i, 12 - i)
  g.quadraticCurveTo(-34 + i, 0, -31 + i, -12 + i)
  g.closePath()
}

function buildBoat(scene: Phaser.Scene): void {
  mk(scene, 'boat_hull', 96, 56, (g) => {
    g.save(); g.translate(48, 28)
    // Outer hull
    const hull = g.createLinearGradient(0, -14, 0, 14)
    hull.addColorStop(0, '#ff7a45'); hull.addColorStop(0.5, '#f0502b'); hull.addColorStop(1, '#c93a1c')
    g.fillStyle = hull; g.strokeStyle = '#8a2412'; g.lineWidth = 2
    hullPath(g); g.fill(); g.stroke()
    // White gunwale
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.4
    hullPath(g, 2.6); g.stroke()
    // Deck
    const deck = g.createLinearGradient(-30, 0, 30, 0)
    deck.addColorStop(0, '#f6e7c4'); deck.addColorStop(1, '#fff6dd')
    g.fillStyle = deck
    hullPath(g, 5); g.fill()
    // Bow stripe
    g.fillStyle = '#ffd23f'
    g.beginPath(); g.moveTo(24, -7); g.lineTo(31, -3.5); g.lineTo(31, 3.5); g.lineTo(24, 7); g.closePath(); g.fill()
    // Cabin
    g.fillStyle = 'rgba(0,30,60,0.25)'; g.beginPath(); g.roundRect(0.5, -8.5, 19, 19, 5); g.fill()
    const cab = g.createLinearGradient(0, -9, 0, 9)
    cab.addColorStop(0, '#5ee0e8'); cab.addColorStop(1, '#1fa3bd')
    g.fillStyle = cab; g.strokeStyle = '#0f6b82'; g.lineWidth = 1.6
    g.beginPath(); g.roundRect(-1, -9.5, 19, 19, 5); g.fill(); g.stroke()
    g.fillStyle = '#12445f'
    g.beginPath(); g.roundRect(12, -7, 4, 14, 1.5); g.fill()
    g.fillStyle = 'rgba(255,255,255,0.55)'
    g.beginPath(); g.roundRect(1.5, -7.5, 8, 3, 1.5); g.fill()
    // Roof beacon
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(5, 0, 2.2, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#ff4a3d'; g.beginPath(); g.arc(5, 0, 1.2, 0, Math.PI * 2); g.fill()
    // Bow light
    g.fillStyle = '#fff6a8'; g.beginPath(); g.arc(30, 0, 1.8, 0, Math.PI * 2); g.fill()
    g.restore()
  })
}


function tenderPath(g: Ctx, inset = 0): void {
  const i = inset
  g.beginPath()
  g.moveTo(-22 + i, -10 + i)
  g.lineTo(10, -10.5 + i)
  g.bezierCurveTo(19, -10.5 + i, 25, -5, 27 - i, 0)
  g.bezierCurveTo(25, 5, 19, 10.5 - i, 10, 10.5 - i)
  g.lineTo(-22 + i, 10 - i)
  g.quadraticCurveTo(-25 + i, 0, -22 + i, -10 + i)
  g.closePath()
}

/** The Cargo Tender: a small, sturdy teal barge with an open cargo well (crates are drawn on top at runtime). */
function buildTender(scene: Phaser.Scene): void {
  mk(scene, 'tender_hull', 64, 38, (g) => {
    g.save(); g.translate(32, 19)
    const hull = g.createLinearGradient(0, -10, 0, 10)
    hull.addColorStop(0, '#45d6a0'); hull.addColorStop(0.5, '#25b383'); hull.addColorStop(1, '#168a66')
    g.fillStyle = hull; g.strokeStyle = '#0c5a42'; g.lineWidth = 1.8
    tenderPath(g); g.fill(); g.stroke()
    g.strokeStyle = '#ffffff'; g.lineWidth = 2
    tenderPath(g, 2.2); g.stroke()
    // Deck
    g.fillStyle = '#f2e6c6'
    tenderPath(g, 4.2); g.fill()
    // Cargo well
    g.fillStyle = 'rgba(40,60,70,0.28)'
    g.beginPath(); g.roundRect(-12, -6.4, 22, 12.8, 2.5); g.fill()
    g.strokeStyle = '#0c5a42'; g.lineWidth = 1.2
    g.beginPath(); g.roundRect(-12.5, -6.9, 23, 13.8, 2.5); g.stroke()
    // Stern cabin
    g.fillStyle = 'rgba(0,30,60,0.25)'; g.beginPath(); g.roundRect(-20, -6, 8, 13, 2.5); g.fill()
    const cab = g.createLinearGradient(0, -6, 0, 7)
    cab.addColorStop(0, '#ffe08a'); cab.addColorStop(1, '#f2a93a')
    g.fillStyle = cab; g.strokeStyle = '#8a5a10'; g.lineWidth = 1.2
    g.beginPath(); g.roundRect(-21, -6.6, 8, 13, 2.2); g.fill(); g.stroke()
    g.fillStyle = '#12445f'; g.beginPath(); g.roundRect(-15.6, -4.2, 2.2, 8.4, 1); g.fill()
    // Bow marker and light
    g.fillStyle = '#ffd23f'
    g.beginPath(); g.moveTo(14, -5); g.lineTo(19.5, -2.4); g.lineTo(19.5, 2.4); g.lineTo(14, 5); g.closePath(); g.fill()
    g.fillStyle = '#fff6a8'; g.beginPath(); g.arc(25, 0, 1.4, 0, Math.PI * 2); g.fill()
    // Roof beacon
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-17, 0, 1.8, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#2fe0a0'; g.beginPath(); g.arc(-17, 0, 1, 0, Math.PI * 2); g.fill()
    g.restore()
  })
}

// ---------------------------------------------------------------------------
// Wildlife
// ---------------------------------------------------------------------------

function buildWildlife(scene: Phaser.Scene): void {
  const fish = (key: string, body: string, belly: string, stripe: string) =>
    mk(scene, key, 28, 16, (g) => {
      g.save(); g.translate(14, 8)
      g.fillStyle = 'rgba(0,40,70,0.22)'; g.beginPath(); g.ellipse(1, 2, 8, 3.6, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = body
      g.beginPath(); g.moveTo(-7, 0); g.lineTo(-13, -5); g.lineTo(-12, 0); g.lineTo(-13, 5); g.closePath(); g.fill()
      const grad = g.createLinearGradient(0, -4, 0, 4)
      grad.addColorStop(0, body); grad.addColorStop(1, belly)
      g.fillStyle = grad
      g.beginPath(); g.ellipse(0, 0, 9, 4.2, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = stripe
      g.fillRect(-1, -4, 2.2, 8); g.fillRect(3.5, -3.4, 1.6, 6.8)
      g.fillStyle = '#10243a'; g.beginPath(); g.arc(6, -1.2, 0.9, 0, Math.PI * 2); g.fill()
      g.restore()
    })
  fish('fish_orange', '#ff9a3d', '#ffd06a', '#ffffff')
  fish('fish_blue', '#3aa8ff', '#9be0ff', '#e9f6ff')
  fish('fish_yellow', '#ffd93a', '#fff3a0', '#3a7bd5')

  mk(scene, 'turtle', 76, 70, (g) => {
    g.save(); g.translate(38, 35)
    g.fillStyle = 'rgba(0,40,70,0.22)'; g.beginPath(); g.ellipse(2, 3, 20, 17, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#6fb86a'; g.strokeStyle = '#3f7d48'; g.lineWidth = 1.6
    const flipper = (x: number, y: number, a: number, l: number) => {
      g.save(); g.translate(x, y); g.rotate(a)
      g.beginPath(); g.ellipse(l / 2, 0, l / 2, 4.6, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore()
    }
    flipper(8, -12, -0.9, 22); flipper(8, 12, 0.9, 22); flipper(-12, -9, -2.4, 14); flipper(-12, 9, 2.4, 14)
    g.beginPath(); g.ellipse(21, 0, 8, 6, 0, 0, Math.PI * 2); g.fill(); g.stroke()
    g.fillStyle = '#1d3a2c'; g.beginPath(); g.arc(24, -3, 1.2, 0, Math.PI * 2); g.arc(24, 3, 1.2, 0, Math.PI * 2); g.fill()
    const shell = g.createRadialGradient(-3, -4, 2, 0, 0, 20)
    shell.addColorStop(0, '#c9a45a'); shell.addColorStop(1, '#8a6a34')
    g.fillStyle = shell; g.strokeStyle = '#5d4520'; g.lineWidth = 2
    g.beginPath(); g.ellipse(0, 0, 18, 15, 0, 0, Math.PI * 2); g.fill(); g.stroke()
    g.strokeStyle = 'rgba(93,69,32,0.8)'; g.lineWidth = 1.4
    g.beginPath(); g.moveTo(-14, 0); g.lineTo(14, 0); g.moveTo(-5, -13); g.lineTo(-5, 13); g.moveTo(6, -11); g.lineTo(6, 11); g.stroke()
    g.restore()
  })

  const cetacean = (key: string, w: number, h: number, body: string, light: string, scale: number) =>
    mk(scene, key, w, h, (g) => {
      g.save(); g.translate(w / 2, h / 2); g.scale(scale, scale)
      g.fillStyle = 'rgba(0,40,70,0.2)'; g.beginPath(); g.ellipse(4, 5, 36, 9, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = body
      // Tail flukes
      g.beginPath(); g.moveTo(-30, 0); g.quadraticCurveTo(-40, -8, -46, -12); g.quadraticCurveTo(-41, 0, -46, 12); g.quadraticCurveTo(-40, 8, -30, 0); g.fill()
      // Body
      const grad = g.createLinearGradient(0, -9, 0, 9)
      grad.addColorStop(0, body); grad.addColorStop(1, light)
      g.fillStyle = grad
      g.beginPath(); g.moveTo(-32, 0); g.bezierCurveTo(-20, -11, 14, -11, 34, -1.5); g.lineTo(40, 0)
      g.lineTo(34, 1.5); g.bezierCurveTo(14, 11, -20, 11, -32, 0); g.fill()
      // Pectoral fins
      g.fillStyle = body
      g.beginPath(); g.moveTo(8, -8); g.quadraticCurveTo(2, -17, -6, -17); g.quadraticCurveTo(0, -10, 2, -7); g.fill()
      g.beginPath(); g.moveTo(8, 8); g.quadraticCurveTo(2, 17, -6, 17); g.quadraticCurveTo(0, 10, 2, 7); g.fill()
      g.fillStyle = '#10243a'; g.beginPath(); g.arc(26, -4.5, 1, 0, Math.PI * 2); g.arc(26, 4.5, 1, 0, Math.PI * 2); g.fill()
      g.restore()
    })
  cetacean('dolphin', 110, 50, '#6f8fb3', '#c8dcec', 1)
  cetacean('whale', 240, 110, '#3f6a96', '#9cc0dd', 2.4)

  mk(scene, 'manta', 110, 100, (g) => {
    g.save(); g.translate(55, 50)
    g.fillStyle = 'rgba(0,40,70,0.2)'; g.beginPath(); g.ellipse(3, 5, 40, 30, 0, 0, Math.PI * 2); g.fill()
    const grad = g.createLinearGradient(0, -40, 0, 40)
    grad.addColorStop(0, '#34506e'); grad.addColorStop(1, '#5a82a6')
    g.fillStyle = grad
    g.beginPath(); g.moveTo(34, 0); g.quadraticCurveTo(14, -10, -22, -42); g.quadraticCurveTo(-14, -8, -20, 0)
    g.quadraticCurveTo(-14, 8, -22, 42); g.quadraticCurveTo(14, 10, 34, 0); g.fill()
    g.strokeStyle = '#34506e'; g.lineWidth = 2.4
    g.beginPath(); g.moveTo(-18, 0); g.quadraticCurveTo(-34, 2, -52, 0); g.stroke()
    g.fillStyle = 'rgba(255,255,255,0.7)'
    for (const [x, y] of [[-2, -14], [-2, 14], [-10, -26], [-10, 26], [8, 0]]) { g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill() }
    g.fillStyle = '#10243a'; g.beginPath(); g.arc(26, -3, 1, 0, Math.PI * 2); g.arc(26, 3, 1, 0, Math.PI * 2); g.fill()
    g.restore()
  })
}

// ---------------------------------------------------------------------------
// Decorations: palms and seabed coral
// ---------------------------------------------------------------------------

function buildDecor(scene: Phaser.Scene): void {
  mk(scene, 'palm', 96, 96, (g) => {
    g.save(); g.translate(48, 48)
    g.fillStyle = 'rgba(0,50,40,0.28)'
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      g.save(); g.translate(5, 6); g.rotate(a); g.beginPath(); g.ellipse(18, 0, 22, 5.5, 0, 0, Math.PI * 2); g.fill(); g.restore()
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2
      g.save(); g.rotate(a)
      const leaf = g.createLinearGradient(0, 0, 40, 0)
      leaf.addColorStop(0, '#2f8f3f'); leaf.addColorStop(1, '#7fd45a')
      g.fillStyle = leaf; g.strokeStyle = '#1f6a2c'; g.lineWidth = 1.2
      g.beginPath(); g.moveTo(2, 0)
      g.bezierCurveTo(14, -10, 32, -9, 43, 0)
      g.bezierCurveTo(32, 9, 14, 10, 2, 0)
      g.fill(); g.stroke()
      g.strokeStyle = '#1f6a2c'; g.lineWidth = 1; g.beginPath(); g.moveTo(3, 0); g.lineTo(40, 0); g.stroke()
      g.restore()
    }
    g.fillStyle = '#7a4a22'; g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#4a2a10'; g.beginPath(); g.arc(-1.6, -1.2, 2, 0, Math.PI * 2); g.arc(1.8, 1.4, 2, 0, Math.PI * 2); g.fill()
    g.restore()
  })

  const palette = [
    ['#ff7aa8', '#ffb0cc'],
    ['#ff9b54', '#ffd08a'],
    ['#b07cff', '#dcc2ff'],
    ['#ff6a6a', '#ffaaa0'],
    ['#4ee6b0', '#b5ffe3'],
    ['#ffd23f', '#fff0a0'],
  ]
  for (let v = 0; v < 6; v++) {
    const rng = new Rng(500 + v)
    mk(scene, `coral_${v}`, 72, 72, (g) => {
      g.save(); g.translate(36, 36)
      const [dark, light] = palette[v]
      if (v % 3 === 0) {
        // brain / round coral
        for (let i = 0; i < 5; i++) {
          const a = rng.range(0, Math.PI * 2); const d = rng.range(0, 14)
          const r = rng.range(8, 14)
          const grad = g.createRadialGradient(Math.cos(a) * d - 2, Math.sin(a) * d - 2, 1, Math.cos(a) * d, Math.sin(a) * d, r)
          grad.addColorStop(0, light); grad.addColorStop(1, dark)
          g.fillStyle = grad; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2); g.fill()
        }
      } else {
        // branching coral
        g.lineCap = 'round'
        for (let b = 0; b < 7; b++) {
          const a = (b / 7) * Math.PI * 2 + rng.range(-0.2, 0.2)
          const len = rng.range(16, 28)
          const mx = Math.cos(a) * len * 0.55; const my = Math.sin(a) * len * 0.55
          const ex = Math.cos(a) * len; const ey = Math.sin(a) * len
          g.strokeStyle = dark; g.lineWidth = 6
          g.beginPath(); g.moveTo(0, 0); g.lineTo(mx, my); g.lineTo(ex, ey); g.stroke()
          g.strokeStyle = light; g.lineWidth = 2.6
          g.beginPath(); g.moveTo(0, 0); g.lineTo(mx, my); g.lineTo(ex, ey); g.stroke()
          g.fillStyle = light; g.beginPath(); g.arc(ex, ey, 3.4, 0, Math.PI * 2); g.fill()
        }
      }
      g.restore()
    })
  }
}

export function buildAllTextures(scene: Phaser.Scene): void {
  buildWater(scene)
  buildSprites(scene)
  buildDebris(scene)
  buildBoat(scene)
  buildTender(scene)
  buildWildlife(scene)
  buildDecor(scene)
}
