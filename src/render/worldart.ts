/** Baking of the static Coral Bay scenery into textures. */
import Phaser from 'phaser'
import { ISLANDS, STATION_JETTIES, STATION_LAND, WORLD, type ObstacleSpot } from '../config/world'
import { Rng, hashSeed } from '../core/rng'
import type { Circle, Obstacle } from '../core/worldgen'
import { mk, TS } from './textures'

type Ctx = CanvasRenderingContext2D

export interface Baked {
  key: string
  /** World position of the texture's top-left corner. */
  x: number
  y: number
}

function layerOf(g: Ctx, draw: (t: Ctx) => void, alpha: number): void {
  const t = document.createElement('canvas')
  t.width = g.canvas.width
  t.height = g.canvas.height
  const tc = t.getContext('2d')!
  tc.scale(TS, TS)
  draw(tc)
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalAlpha = alpha
  g.drawImage(t, 0, 0)
  g.restore()
}

function union(t: Ctx, circles: readonly Circle[], extra: number, color: string, dx = 0, dy = 0, scale = 1): void {
  t.fillStyle = color
  t.beginPath()
  for (const c of circles) {
    const r = Math.max(1, c.r * scale + extra)
    t.moveTo(c.x + dx + r, c.y + dy)
    t.arc(c.x + dx, c.y + dy, r, 0, Math.PI * 2)
  }
  t.fill()
}

/** Bake an organic landmass from overlapping circles. */
export function bakeLandmass(
  scene: Phaser.Scene,
  key: string,
  circles: readonly Circle[],
  seed: number,
): Baked {
  const rng = new Rng(seed)
  const all: Circle[] = [...circles]
  for (const c of circles) {
    const bumps = 4 + Math.floor(c.r / 60)
    for (let i = 0; i < bumps; i++) {
      const a = rng.range(0, Math.PI * 2)
      const r = c.r * rng.range(0.22, 0.34)
      all.push({ x: c.x + Math.cos(a) * c.r * 0.86, y: c.y + Math.sin(a) * c.r * 0.86, r })
    }
  }
  const pad = 96
  const minX = Math.floor(Math.min(...all.map((c) => c.x - c.r)) - pad)
  const minY = Math.floor(Math.min(...all.map((c) => c.y - c.r)) - pad)
  const maxX = Math.ceil(Math.max(...all.map((c) => c.x + c.r)) + pad)
  const maxY = Math.ceil(Math.max(...all.map((c) => c.y + c.r)) + pad)
  const local = all.map((c) => ({ x: c.x - minX, y: c.y - minY, r: c.r }))
  const inner = circles.map((c) => ({ x: c.x - minX, y: c.y - minY, r: c.r }))

  mk(scene, key, maxX - minX, maxY - minY, (g) => {
    layerOf(g, (t) => union(t, local, 70, '#7ff0dc'), 0.13)
    layerOf(g, (t) => union(t, local, 48, '#8cf5e2'), 0.18)
    layerOf(g, (t) => union(t, local, 28, '#aaf8ea'), 0.26)
    layerOf(g, (t) => union(t, local, 13, '#ffffff'), 0.9)
    layerOf(g, (t) => union(t, local, 4, '#e3c987', 3, 5), 1)
    layerOf(g, (t) => union(t, local, 3, '#f6e3a6'), 1)
    layerOf(g, (t) => union(t, local, -9, '#ffefbf', -2, -3), 0.8)
    layerOf(g, (t) => union(t, inner, 0, '#3f9e48', 0, 0, 0.74), 1)
    layerOf(g, (t) => union(t, inner, 0, '#62c457', -2, -3, 0.68), 1)
    layerOf(g, (t) => union(t, inner, 0, '#86dc6c', -5, -7, 0.5), 0.75)
    // little shore pebbles
    const pr = new Rng(hashSeed(seed, 'pebbles'))
    for (let i = 0; i < local.length * 5; i++) {
      const c = local[pr.int(0, local.length - 1)]
      const a = pr.range(0, Math.PI * 2)
      const d = c.r * pr.range(0.8, 0.97)
      g.fillStyle = pr.next() > 0.5 ? 'rgba(200,170,110,0.9)' : 'rgba(255,255,255,0.7)'
      g.beginPath(); g.arc(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, pr.range(1.2, 2.6), 0, Math.PI * 2); g.fill()
    }
  })
  return { key, x: minX, y: minY }
}

export function bakeRock(scene: Phaser.Scene, key: string, spot: ObstacleSpot, seed: number): Baked {
  const rng = new Rng(seed)
  const pad = 70
  const size = spot.r * 2 + pad * 2
  mk(scene, key, size, size, (g) => {
    const c = size / 2
    const circ = [{ x: c, y: c, r: spot.r }]
    layerOf(g, (t) => union(t, circ, 46, '#7ff0dc'), 0.16)
    layerOf(g, (t) => union(t, circ, 26, '#aaf8ea'), 0.26)
    layerOf(g, (t) => union(t, circ, 12, '#ffffff'), 0.85)
    // jagged body
    const pts: [number, number][] = []
    const n = 11
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = spot.r * rng.range(0.86, 1.04)
      pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r])
    }
    const shape = (ox = 0, oy = 0, s = 1) => {
      g.beginPath()
      pts.forEach(([x, y], i) => {
        const px = c + (x - c) * s + ox
        const py = c + (y - c) * s + oy
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py)
      })
      g.closePath()
    }
    g.fillStyle = 'rgba(0,40,70,0.3)'; shape(4, 6); g.fill()
    const grad = g.createLinearGradient(c - spot.r, c - spot.r, c + spot.r, c + spot.r)
    grad.addColorStop(0, '#b9c3cc'); grad.addColorStop(1, '#58687a')
    g.fillStyle = grad; g.strokeStyle = '#3e4b5a'; g.lineWidth = 2
    shape(); g.fill(); g.stroke()
    g.fillStyle = '#cfd8df'; shape(-spot.r * 0.1, -spot.r * 0.14, 0.62); g.fill()
    g.fillStyle = 'rgba(255,255,255,0.45)'; shape(-spot.r * 0.18, -spot.r * 0.22, 0.28); g.fill()
  })
  return { key, x: spot.x - size / 2, y: spot.y - size / 2 }
}

export function bakeReef(scene: Phaser.Scene, key: string, spot: ObstacleSpot, seed: number): Baked {
  const rng = new Rng(seed)
  const pad = 80
  const size = spot.r * 2 + pad * 2
  const colors = [
    ['#ff7aa8', '#ffc1d6'],
    ['#ff9b54', '#ffd9a8'],
    ['#b07cff', '#e2d0ff'],
    ['#ff6a6a', '#ffb4ac'],
    ['#4ee6b0', '#c4ffe9'],
  ]
  mk(scene, key, size, size, (g) => {
    const c = size / 2
    const circ = [{ x: c, y: c, r: spot.r }]
    layerOf(g, (t) => union(t, circ, 56, '#6fe8d6'), 0.2)
    layerOf(g, (t) => union(t, circ, 34, '#98f4e4'), 0.3)
    layerOf(g, (t) => union(t, circ, 14, '#ffffff'), 0.55)
    layerOf(g, (t) => union(t, circ, 2, '#2f8f86'), 0.55)
    const blobs = 12 + Math.floor(spot.r / 8)
    for (let i = 0; i < blobs; i++) {
      const a = rng.range(0, Math.PI * 2)
      const d = spot.r * Math.sqrt(rng.next()) * 0.82
      const r = rng.range(spot.r * 0.18, spot.r * 0.34)
      const [dark, light] = rng.pick(colors)
      const x = c + Math.cos(a) * d
      const y = c + Math.sin(a) * d
      g.fillStyle = 'rgba(0,40,70,0.25)'; g.beginPath(); g.arc(x + 2, y + 3, r, 0, Math.PI * 2); g.fill()
      const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r)
      grad.addColorStop(0, light); grad.addColorStop(1, dark)
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2
      g.beginPath(); g.arc(x - r * 0.1, y - r * 0.1, r * 0.55, 0.3, 3.6); g.stroke()
    }
  })
  return { key, x: spot.x - size / 2, y: spot.y - size / 2 }
}

// ---------------------------------------------------------------------------
// Station
// ---------------------------------------------------------------------------

export const STATION_ART = { x: 60, y: 2880, w: 700, h: 360 }

export function bakeStation(scene: Phaser.Scene): Baked {
  const { x: ox, y: oy, w, h } = STATION_ART
  mk(scene, 'station', w, h, (g) => {
    g.translate(-ox, -oy)
    const wood = (x: number, y: number, ww: number, hh: number, vertical = false) => {
      g.fillStyle = 'rgba(0,40,70,0.28)'; g.fillRect(x + 3, y + 5, ww, hh)
      g.fillStyle = '#c8905a'; g.fillRect(x, y, ww, hh)
      g.strokeStyle = '#8a5a30'; g.lineWidth = 1.4
      if (vertical) for (let i = 8; i < hh; i += 9) { g.beginPath(); g.moveTo(x, y + i); g.lineTo(x + ww, y + i); g.stroke() }
      else for (let i = 9; i < ww; i += 10) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i, y + hh); g.stroke() }
      g.strokeStyle = '#6a4220'; g.lineWidth = 2; g.strokeRect(x, y, ww, hh)
    }
    // Jetties framing the docking slip
    for (const j of STATION_JETTIES) wood(j.x0 - 14, j.y - 14, j.x1 - j.x0 + 28, 28)
    // Dock apron (concrete)
    g.fillStyle = 'rgba(0,40,70,0.28)'; g.beginPath(); g.roundRect(486, 2995, 112, 64, 8); g.fill()
    g.fillStyle = '#cfd8de'; g.strokeStyle = '#8a98a4'; g.lineWidth = 2
    g.beginPath(); g.roundRect(480, 2988, 112, 64, 8); g.fill(); g.stroke()
    g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.setLineDash([12, 9])
    g.beginPath(); g.moveTo(500, 3020); g.lineTo(585, 3020); g.stroke(); g.setLineDash([])
    // Bollards
    g.fillStyle = '#2d3b49'
    for (const [bx, by] of [[578, 2994], [578, 3046], [545, 2994], [545, 3046]]) { g.beginPath(); g.arc(bx, by, 4.5, 0, Math.PI * 2); g.fill() }
    // Conveyor from hall to apron
    g.fillStyle = '#39485a'; g.fillRect(400, 3010, 90, 22)
    g.strokeStyle = '#ffd23f'; g.lineWidth = 2
    for (let i = 404; i < 490; i += 10) { g.beginPath(); g.moveTo(i, 3012); g.lineTo(i, 3030); g.stroke() }
    // Main hall
    g.fillStyle = 'rgba(0,40,70,0.3)'; g.beginPath(); g.roundRect(256, 3000, 150, 108, 10); g.fill()
    const roof = g.createLinearGradient(250, 2990, 250, 3098)
    roof.addColorStop(0, '#ff6a4a'); roof.addColorStop(1, '#d6401f')
    g.fillStyle = roof; g.strokeStyle = '#8a2412'; g.lineWidth = 3
    g.beginPath(); g.roundRect(248, 2992, 150, 106, 10); g.fill(); g.stroke()
    g.fillStyle = '#ffffff'; g.fillRect(248, 3036, 150, 10)
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(256, 2998, 134, 8)
    // Solar panels
    g.fillStyle = '#1f6fa8'; g.strokeStyle = '#d9f1ff'; g.lineWidth = 1.2
    for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(262 + i * 44, 3054, 38, 32, 3); g.fill(); g.stroke() }
    // Processing tanks (round, top-down)
    const tank = (cx: number, cy: number, r: number) => {
      g.fillStyle = 'rgba(0,40,70,0.3)'; g.beginPath(); g.arc(cx + 4, cy + 6, r, 0, Math.PI * 2); g.fill()
      const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r)
      grad.addColorStop(0, '#f2f6f8'); grad.addColorStop(1, '#8fa2b0')
      g.fillStyle = grad; g.strokeStyle = '#5c6e7c'; g.lineWidth = 2.4
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke()
      g.strokeStyle = '#2fbf9c'; g.lineWidth = 4
      g.beginPath(); g.arc(cx, cy, r * 0.62, 0, Math.PI * 2); g.stroke()
      g.fillStyle = '#5c6e7c'; g.beginPath(); g.arc(cx, cy, r * 0.16, 0, Math.PI * 2); g.fill()
    }
    tank(228, 3040, 30); tank(206, 3100, 24); tank(176, 3000, 20)
    // Pipes
    g.strokeStyle = '#6f8392'; g.lineWidth = 6; g.lineCap = 'round'
    g.beginPath(); g.moveTo(250, 3040); g.lineTo(258, 3040); g.moveTo(206, 3076); g.lineTo(206, 3060); g.stroke()
    // Crates near the apron
    const crates: [number, number, string][] = [[430, 3070, '#ff9b54'], [458, 3078, '#4ee6b0'], [440, 3098, '#b07cff'], [470, 3105, '#ffd23f']]
    for (const [cx, cy, col] of crates) {
      g.fillStyle = 'rgba(0,40,70,0.3)'; g.fillRect(cx + 3, cy + 4, 22, 20)
      g.fillStyle = col; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.6
      g.fillRect(cx, cy, 22, 20); g.strokeRect(cx, cy, 22, 20)
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(cx + 3, cy + 6); g.lineTo(cx + 19, cy + 6); g.stroke()
    }
    // Flag pole
    g.fillStyle = '#e8eef2'; g.beginPath(); g.arc(438, 3004, 3, 0, Math.PI * 2); g.fill()
  })
  return { key: 'station', x: ox, y: oy }
}

// ---------------------------------------------------------------------------
// Depth layer: shallow turquoise near land, dark blue in the deep
// ---------------------------------------------------------------------------

export function buildDepthLayer(scene: Phaser.Scene, solids: readonly Obstacle[]): void {
  const cell = 16
  const cols = Math.ceil(WORLD.width / cell)
  const rows = Math.ceil(WORLD.height / cell)
  const c = document.createElement('canvas')
  c.width = cols
  c.height = rows
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(cols, rows)
  const shallowCasters = solids.filter((s) => s.kind !== 'rock')
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell
      const y = (j + 0.5) * cell
      let nearest = 1e9
      for (const s of shallowCasters) {
        const d = Math.hypot(x - s.x, y - s.y) - s.r
        if (d < nearest) nearest = d
      }
      const shallow = Math.pow(1 - smooth(0, 260, nearest), 1.4) * 0.5
      const fromDock = Math.hypot(x - WORLD.dock.x, y - WORLD.dock.y)
      const deep = smooth(1500, 3900, fromDock) * 0.42
      const patch = (Math.sin(x * 0.0021 + 1.3) * Math.sin(y * 0.0017 + 0.4) * 0.5 + 0.5) * 0.1
      // Composite shallow (aqua) over deep (navy)
      const aS = shallow
      const aD = Math.min(0.6, deep + patch)
      const a = aS + aD * (1 - aS)
      const k = (j * cols + i) * 4
      if (a <= 0.001) { img.data[k + 3] = 0; continue }
      const r = (150 * aS + 12 * aD * (1 - aS)) / a
      const gc = (245 * aS + 50 * aD * (1 - aS)) / a
      const b = (225 * aS + 130 * aD * (1 - aS)) / a
      img.data[k] = r
      img.data[k + 1] = gc
      img.data[k + 2] = b
      img.data[k + 3] = a * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  if (scene.textures.exists('depth')) scene.textures.remove('depth')
  scene.textures.addCanvas('depth', c)
}

export { ISLANDS, STATION_LAND }
