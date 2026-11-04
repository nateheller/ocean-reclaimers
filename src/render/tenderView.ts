/** Visuals for the Cargo Tender fleet: hull, visible cargo crates, a small floating status tag and a light wake. */
import Phaser from 'phaser'
import type { Tender, TenderStatus } from '../core/tender'
import { TENDER_STATUS_LABEL } from '../core/tender'
import { TS } from './textures'

const CRATE = { bottle: 0x6cc7ff, container: 0xff9b2e, net: 0x8fe05a }

export const TENDER_STATUS_COLOR: Record<TenderStatus, string> = {
  idle: '#bff7ff',
  toPlayer: '#ffe14a',
  loading: '#ffe14a',
  delivering: '#6cf0c1',
  unloading: '#6cf0c1',
  returning: '#bff7ff',
}

interface View {
  id: number
  shadow: Phaser.GameObjects.Image
  box: Phaser.GameObjects.Container
  hull: Phaser.GameObjects.Image
  cargo: Phaser.GameObjects.Graphics
  tag: Phaser.GameObjects.Text
  cargoKey: string
  statusKey: string
  wakeAcc: number
  phase: number
}

export class TenderView {
  private views = new Map<number, View>()
  /** Called for every wake particle to emit (world position). */
  onWake: (x: number, y: number) => void = () => {}

  constructor(private scene: Phaser.Scene, private depth: number, private textDepth: number) {}

  /** Make views match the fleet; returns ids that were just created. */
  sync(tenders: readonly Tender[]): number[] {
    const created: number[] = []
    const alive = new Set(tenders.map((t) => t.id))
    for (const [id, v] of this.views) {
      if (!alive.has(id)) {
        this.destroyView(v)
        this.views.delete(id)
      }
    }
    tenders.forEach((t, slot) => {
      if (this.views.has(t.id)) return
      const shadow = this.scene.add.image(0, 0, 'blob').setScale(1.15, 0.7).setAlpha(0.7).setDepth(this.depth - 0.1)
      const hull = this.scene.add.image(0, 0, 'tender_hull').setScale(1 / TS)
      const cargo = this.scene.add.graphics()
      const box = this.scene.add.container(t.x, t.y, [hull, cargo]).setDepth(this.depth)
      const tag = this.scene.add
        .text(t.x, t.y - 30, '', {
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
      const view: View = { id: t.id, shadow, box, hull, cargo, tag, cargoKey: '', statusKey: '', wakeAcc: 0, phase: slot * 1.7 }
      this.views.set(t.id, view)
      created.push(t.id)
    })
    return created
  }

  update(tenders: readonly Tender[], timeMs: number, dt: number): void {
    tenders.forEach((t, slot) => {
      const v = this.views.get(t.id)
      if (!v) return
      const bob = Math.sin(timeMs * 0.003 + v.phase) * 0.8
      v.box.setPosition(t.x, t.y + bob).setRotation(t.heading)
      v.box.setScale(1 + Math.sin(timeMs * 0.0034 + v.phase) * 0.012)
      v.shadow.setPosition(t.x + 3, t.y + 5).setRotation(t.heading)
      v.tag.setPosition(t.x, t.y - 32)
      const statusKey = `${t.status}`
      if (statusKey !== v.statusKey) {
        v.statusKey = statusKey
        v.tag.setText(`T${slot + 1}  ${TENDER_STATUS_LABEL[t.status]}`)
        v.tag.setColor(TENDER_STATUS_COLOR[t.status])
      }
      v.tag.setAlpha(t.status === 'idle' ? 0.75 : 1)
      const key = `${t.cargo.bottle},${t.cargo.container},${t.cargo.net}`
      if (key !== v.cargoKey) {
        v.cargoKey = key
        this.drawCargo(v, t)
      }
      // Light wake while moving.
      const sp = Math.abs(t.speed)
      v.wakeAcc += (sp / 260) * 40 * dt
      while (v.wakeAcc >= 1) {
        v.wakeAcc -= 1
        const c = Math.cos(t.heading)
        const s = Math.sin(t.heading)
        const side = Math.random() < 0.5 ? -1 : 1
        this.onWake(t.x - c * (24 + Math.random() * 5) - s * side * 4, t.y - s * (24 + Math.random() * 5) + c * side * 4)
      }
    })
  }

  private drawCargo(v: View, t: Tender): void {
    const g = v.cargo
    g.clear()
    const items: number[] = []
    for (let i = 0; i < t.cargo.net; i++) items.push(CRATE.net)
    for (let i = 0; i < t.cargo.container; i++) items.push(CRATE.container)
    for (let i = 0; i < t.cargo.bottle; i++) items.push(CRATE.bottle)
    // Cargo well: x -12..10, y -6..6 -> up to 4 x 2 crates; heaps beyond that stack taller.
    const cols = 4
    const rows = 2
    const size = 4.6
    const gap = 0.9
    const shown = Math.min(items.length, cols * rows)
    for (let i = 0; i < shown; i++) {
      const c = i % cols
      const r = Math.floor(i / cols)
      const x = -11 + c * (size + gap)
      const y = -5.2 + r * (size + gap)
      g.fillStyle(0x000000, 0.2)
      g.fillRoundedRect(x + 0.6, y + 0.8, size, size, 1)
      g.fillStyle(items[Math.floor((i * items.length) / shown)], 1)
      g.fillRoundedRect(x, y, size, size, 1)
      g.fillStyle(0xffffff, 0.5)
      g.fillRect(x + 0.8, y + 0.8, size - 2, 0.9)
    }
    if (items.length > cols * rows) {
      // A second layer for bigger loads.
      const extra = Math.min(items.length - cols * rows, cols * rows)
      for (let i = 0; i < extra; i++) {
        const c = i % cols
        const r = Math.floor(i / cols)
        g.fillStyle(0xffffff, 0.35)
        g.fillRoundedRect(-11 + c * (size + gap) + 0.9, -5.2 + r * (size + gap) - 0.9, size - 1.4, size - 1.4, 1)
      }
    }
  }

  getPosition(id: number): { x: number; y: number } | null {
    const v = this.views.get(id)
    return v ? { x: v.box.x, y: v.box.y } : null
  }

  setVisible(visible: boolean): void {
    for (const v of this.views.values()) {
      v.box.setVisible(visible)
      v.shadow.setVisible(visible)
      v.tag.setVisible(visible)
    }
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
