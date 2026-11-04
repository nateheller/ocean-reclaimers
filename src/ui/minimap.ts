/**
 * Corner minimap: a compact painted chart of Coral Bay with the boat, the station, the camera view and (when the
 * player has the gear for it) remaining debris concentrations. Press Tab - or click it - to enlarge it.
 *
 * The chart is baked once per size into an offscreen canvas; only the small live layer is redrawn, a few times a
 * second, so it costs almost nothing.
 */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { Point, ViewRect } from '../core/navigation'
import type { SensorMarker } from '../core/sensors'
import { buildObstacles } from '../core/worldgen'

export interface MinimapData {
  boat: Point & { heading: number }
  view: ViewRect
  station: Point
  /** Remaining-debris overlays (empty when the player has no detection gear). */
  markers: readonly SensorMarker[]
  tenders: readonly Point[]
  trawlers: readonly Point[]
}

interface Baked {
  canvas: HTMLCanvasElement
  w: number
  h: number
  dpr: number
}

export class Minimap {
  readonly el: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly baked = new Map<boolean, Baked>()
  private big = false
  private lastDraw = -1
  private last: MinimapData | null = null

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'minimap'
    this.el.innerHTML = '<canvas></canvas><div class="mm-cap"><kbd>Tab</kbd><span>Map</span></div>'
    parent.appendChild(this.el)
    this.canvas = this.el.querySelector('canvas') as HTMLCanvasElement
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D
    this.el.style.pointerEvents = 'auto'
    this.el.addEventListener('click', () => this.toggle())
    this.resize()
  }

  get expanded(): boolean {
    return this.big
  }

  toggle(): void {
    this.setExpanded(!this.big)
  }

  setExpanded(on: boolean): void {
    if (on === this.big) return
    this.big = on
    this.el.classList.toggle('big', on)
    this.resize()
    if (this.last) this.draw(this.last, performance.now() / 1000)
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('hidden', !visible)
  }

  private size(): { w: number; h: number } {
    const w = this.big ? BALANCE.hud.minimapWidthExpanded : BALANCE.hud.minimapWidth
    return { w, h: Math.round((w * WORLD.height) / WORLD.width) }
  }

  private resize(): void {
    const { w, h } = this.size()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
  }

  // ---- static chart --------------------------------------------------------------------------------------------------

  private bake(): Baked {
    const cached = this.baked.get(this.big)
    const { w, h } = this.size()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (cached && cached.dpr === dpr) return cached
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const g = canvas.getContext('2d') as CanvasRenderingContext2D
    g.scale(dpr, dpr)
    const sx = w / WORLD.width
    const sy = h / WORLD.height

    // Water: deeper blue with the shallows brighter toward the station.
    const water = g.createLinearGradient(0, 0, w, h)
    water.addColorStop(0, '#0f5f93')
    water.addColorStop(1, '#1b8fc0')
    g.fillStyle = water
    g.fillRect(0, 0, w, h)
    g.save()
    g.beginPath()
    g.rect(0, 0, w, h)
    g.clip()
    const dock = WORLD.dock
    for (const [r, color] of [
      [WORLD.shallowsRadius, 'rgba(120, 220, 235, 0.16)'],
      [WORLD.harborRadius, 'rgba(160, 240, 235, 0.2)'],
    ] as const) {
      g.fillStyle = color
      g.beginPath()
      g.ellipse(dock.x * sx, dock.y * sy, r * sx, r * sy, 0, 0, Math.PI * 2)
      g.fill()
    }
    g.setLineDash([4, 4])
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = 1
    for (const r of [WORLD.harborRadius, WORLD.shallowsRadius]) {
      g.beginPath()
      g.ellipse(dock.x * sx, dock.y * sy, r * sx, r * sy, 0, 0, Math.PI * 2)
      g.stroke()
    }
    g.setLineDash([])
    g.restore()

    // Land, rocks and reefs.
    const obstacles = buildObstacles()
    for (const o of obstacles) {
      if (o.kind === 'reef') {
        g.fillStyle = 'rgba(255, 150, 130, 0.45)'
        g.beginPath()
        g.ellipse(o.x * sx, o.y * sy, Math.max(1.2, o.r * sx), Math.max(1.2, o.r * sy), 0, 0, Math.PI * 2)
        g.fill()
      }
    }
    for (const o of obstacles) {
      if (o.kind === 'reef') continue
      const land = o.kind === 'island' || o.kind === 'land'
      g.fillStyle = land ? '#efd99a' : '#8d9aa4'
      g.beginPath()
      g.ellipse(o.x * sx, o.y * sy, Math.max(1, o.r * sx), Math.max(1, o.r * sy), 0, 0, Math.PI * 2)
      g.fill()
    }
    for (const o of obstacles) {
      if (o.kind !== 'island' && o.kind !== 'land') continue
      g.fillStyle = '#74c46c'
      g.beginPath()
      g.ellipse(o.x * sx, o.y * sy, Math.max(0.8, o.r * 0.62 * sx), Math.max(0.8, o.r * 0.62 * sy), 0, 0, Math.PI * 2)
      g.fill()
    }

    // Area names (expanded chart only).
    if (this.big) {
      g.font = '700 10px Reclaimer, "Trebuchet MS", sans-serif'
      g.textAlign = 'center'
      g.fillStyle = 'rgba(255,255,255,0.8)'
      g.shadowColor = 'rgba(0,30,60,0.9)'
      g.shadowBlur = 3
      const label = (text: string, x: number, y: number) => g.fillText(text, x * sx, y * sy)
      label('HARBOR', dock.x + WORLD.harborRadius * 0.55, dock.y - WORLD.harborRadius * 0.62)
      label('THE SHALLOWS', dock.x + (WORLD.harborRadius + WORLD.shallowsRadius) * 0.36, dock.y - (WORLD.harborRadius + WORLD.shallowsRadius) * 0.5)
      label('OPEN WATER', WORLD.width * 0.8, WORLD.height * 0.18)
      g.shadowBlur = 0
    }

    // Frame.
    g.strokeStyle = 'rgba(255,255,255,0.55)'
    g.lineWidth = 2
    g.strokeRect(1, 1, w - 2, h - 2)

    const baked = { canvas, w, h, dpr }
    this.baked.set(this.big, baked)
    return baked
  }

  // ---- live layer ----------------------------------------------------------------------------------------------------------

  /** Redraw at most ~20 times a second. */
  update(data: MinimapData, nowSeconds: number): void {
    this.last = data
    if (nowSeconds - this.lastDraw < 0.05) return
    this.draw(data, nowSeconds)
  }

  private draw(data: MinimapData, now: number): void {
    this.lastDraw = now
    const baked = this.bake()
    const { w, h, dpr } = baked
    const g = this.ctx
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.drawImage(baked.canvas, 0, 0, w, h)
    const sx = w / WORLD.width
    const sy = h / WORLD.height

    // Remaining debris: soft pulsing blobs for concentrations, tiny dots for individual items.
    const pulse = 0.5 + 0.5 * Math.sin(now * 3)
    for (const m of data.markers) {
      if (m.kind === 'cluster') {
        const r = Math.max(4, m.radius * sx)
        const grad = g.createRadialGradient(m.x * sx, m.y * sy, 0, m.x * sx, m.y * sy, r * 1.3)
        grad.addColorStop(0, `rgba(255, 224, 80, ${0.55 + pulse * 0.3})`)
        grad.addColorStop(1, 'rgba(255, 224, 80, 0)')
        g.fillStyle = grad
        g.beginPath()
        g.arc(m.x * sx, m.y * sy, r * 1.3, 0, Math.PI * 2)
        g.fill()
      }
    }
    for (const m of data.markers) {
      if (m.kind !== 'item') continue
      g.fillStyle = '#fff2a8'
      g.fillRect(m.x * sx - 1, m.y * sy - 1, 2, 2)
    }

    // Camera view.
    g.strokeStyle = 'rgba(255,255,255,0.5)'
    g.lineWidth = 1
    g.strokeRect(data.view.x * sx, data.view.y * sy, data.view.width * sx, data.view.height * sy)

    // Fleet.
    g.fillStyle = '#6cf0c1'
    for (const p of data.tenders) {
      g.beginPath()
      g.arc(p.x * sx, p.y * sy, 2.4, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#c59bff'
    for (const p of data.trawlers) {
      g.beginPath()
      g.arc(p.x * sx, p.y * sy, 2.8, 0, Math.PI * 2)
      g.fill()
    }

    // Station.
    const st = data.station
    g.save()
    g.translate(st.x * sx, st.y * sy)
    g.fillStyle = '#ffd23f'
    g.strokeStyle = '#6a4300'
    g.lineWidth = 1.2
    g.beginPath()
    g.moveTo(0, -5.5)
    g.lineTo(5.5, 0)
    g.lineTo(0, 5.5)
    g.lineTo(-5.5, 0)
    g.closePath()
    g.fill()
    g.stroke()
    g.restore()
    if (this.big) {
      g.font = '700 10px Reclaimer, "Trebuchet MS", sans-serif'
      g.textAlign = 'left'
      g.fillStyle = '#fff'
      g.shadowColor = 'rgba(0,30,60,0.9)'
      g.shadowBlur = 3
      g.fillText('Station', st.x * sx + 8, st.y * sy - 6)
      g.shadowBlur = 0
    }

    // The boat: a bright arrow with a dark outline so it reads on any colour.
    g.save()
    g.translate(data.boat.x * sx, data.boat.y * sy)
    g.rotate(data.boat.heading)
    const s = this.big ? 7 : 6
    g.beginPath()
    g.moveTo(s, 0)
    g.lineTo(-s * 0.75, s * 0.7)
    g.lineTo(-s * 0.35, 0)
    g.lineTo(-s * 0.75, -s * 0.7)
    g.closePath()
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#0a2c48'
    g.lineWidth = 1.6
    g.stroke()
    g.fill()
    g.restore()
  }
}
