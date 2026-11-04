/** Visuals for the Auto Trawler fleet: violet catamaran, visible hopper load, a status tag, a rotating radar and a wake. */
import Phaser from 'phaser'
import { TRAWLER_STATUS_LABEL, type Trawler, type TrawlerStatus } from '../core/trawler'
import { TS } from './textures'

const ITEM = { bottle: 0x6cc7ff, container: 0xff9b2e, net: 0x8fe05a }

export const TRAWLER_STATUS_COLOR: Record<TrawlerStatus, string> = {
  searching: '#bff7ff',
  collecting: '#ffe14a',
  returning: '#c59bff',
  unloading: '#6cf0c1',
  departing: '#bff7ff',
}

interface View {
  id: number
  shadow: Phaser.GameObjects.Image
  box: Phaser.GameObjects.Container
  hull: Phaser.GameObjects.Image
  hopper: Phaser.GameObjects.Graphics
  radar: Phaser.GameObjects.Graphics
  tag: Phaser.GameObjects.Text
  hopperKey: string
  statusKey: string
  wakeAcc: number
  phase: number
  /** Scoop pulse (0..1) played each time an item is taken. */
  pulse: number
}

export class TrawlerView {
  private views = new Map<number, View>()
  /** Called for every wake particle to emit (world position). */
  onWake: (x: number, y: number) => void = () => {}

  constructor(private scene: Phaser.Scene, private depth: number, private textDepth: number) {}

  /** Make views match the fleet; returns the ids that were just created. */
  sync(trawlers: readonly Trawler[]): number[] {
    const created: number[] = []
    const alive = new Set(trawlers.map((t) => t.id))
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.destroyView(v)
        this.views.delete(id)
      }
    }
    trawlers.forEach((t, slot) => {
      if (this.views.has(t.id)) return
      const shadow = this.scene.add.image(0, 0, 'blob').setScale(1.45, 0.85).setAlpha(0.7).setDepth(this.depth - 0.1)
      const hull = this.scene.add.image(0, 0, 'trawler_hull').setScale(1 / TS)
      const hopper = this.scene.add.graphics()
      const radar = this.scene.add.graphics().setPosition(-18, 0)
      radar.lineStyle(1.3, 0xe9dcff, 0.95)
      radar.lineBetween(0, 0, 5.2, 0)
      radar.fillStyle(0xc59bff, 0.35)
      radar.slice(0, 0, 8, -0.5, 0, false)
      radar.fillPath()
      const box = this.scene.add.container(t.x, t.y, [hull, hopper, radar]).setDepth(this.depth)
      const tag = this.scene.add
        .text(t.x, t.y - 34, '', {
          fontFamily: 'Reclaimer, Trebuchet MS, sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#bff7ff',
          stroke: '#082a49',
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(this.textDepth)
      this.views.set(t.id, { id: t.id, shadow, box, hull, hopper, radar, tag, hopperKey: '', statusKey: '', wakeAcc: 0, phase: slot * 2.3, pulse: 0 })
      created.push(t.id)
    })
    return created
  }

  /** Play the little scoop animation on a trawler that just took an item. */
  scoop(id: number): void {
    const v = this.views.get(id)
    if (v) v.pulse = 1
  }

  update(trawlers: readonly Trawler[], timeMs: number, dt: number): void {
    trawlers.forEach((t, slot) => {
      const v = this.views.get(t.id)
      if (!v) return
      v.pulse = Math.max(0, v.pulse - dt * 4.5)
      const bob = Math.sin(timeMs * 0.003 + v.phase) * 0.8
      v.box.setPosition(t.x, t.y + bob).setRotation(t.heading)
      v.box.setScale(1 + Math.sin(timeMs * 0.0034 + v.phase) * 0.012 + v.pulse * 0.06)
      v.shadow.setPosition(t.x + 3, t.y + 6).setRotation(t.heading)
      v.radar.setRotation(timeMs * 0.0045 + v.phase)
      v.tag.setPosition(t.x, t.y - 36)
      const statusKey = t.status
      if (statusKey !== v.statusKey) {
        v.statusKey = statusKey
        v.tag.setText(`A${slot + 1}  ${TRAWLER_STATUS_LABEL[t.status]}`)
        v.tag.setColor(TRAWLER_STATUS_COLOR[t.status])
      }
      v.tag.setAlpha(t.status === 'searching' ? 0.8 : 1)
      const key = `${t.cargo.bottle},${t.cargo.container},${t.cargo.net}`
      if (key !== v.hopperKey) {
        v.hopperKey = key
        this.drawHopper(v, t)
      }
      const sp = Math.abs(t.speed)
      v.wakeAcc += (sp / 260) * 42 * dt
      while (v.wakeAcc >= 1) {
        v.wakeAcc -= 1
        const c = Math.cos(t.heading)
        const s = Math.sin(t.heading)
        const side = Math.random() < 0.5 ? -1 : 1
        this.onWake(t.x - c * (30 + Math.random() * 5) - s * side * 6, t.y - s * (30 + Math.random() * 5) + c * side * 6)
      }
    })
  }

  /** Items inside the sealed hopper show as coloured pips (up to 6), so a full trawler is easy to spot. */
  private drawHopper(v: View, t: Trawler): void {
    const g = v.hopper
    g.clear()
    const items: number[] = []
    for (let i = 0; i < t.cargo.net; i++) items.push(ITEM.net)
    for (let i = 0; i < t.cargo.container; i++) items.push(ITEM.container)
    for (let i = 0; i < t.cargo.bottle; i++) items.push(ITEM.bottle)
    const shown = Math.min(items.length, 6)
    for (let i = 0; i < shown; i++) {
      const c = i % 3
      const r = Math.floor(i / 3)
      const x = 0.4 + c * 2.9
      const y = -2.6 + r * 3.1
      g.fillStyle(items[Math.floor((i * items.length) / shown)], 1)
      g.fillRoundedRect(x, y, 2.5, 2.5, 0.8)
    }
  }

  getPosition(id: number): { x: number; y: number } | null {
    const v = this.views.get(id)
    return v ? { x: v.box.x, y: v.box.y } : null
  }

  clear(): void {
    for (const v of this.views.values()) this.destroyView(v)
    this.views.clear()
  }

  private destroyView(v: View): void {
    v.shadow.destroy()
    v.box.destroy()
    v.tag.destroy()
  }
}
