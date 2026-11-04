/** The player's boat: hull, collection arms, hold crates and engines (upgrades are visible). */
import Phaser from 'phaser'
import { BALANCE } from '../config/balance'
import type { CargoCounts } from '../core/cargo'
import type { UpgradeFlags } from '../core/stats'
import { vesselStats } from '../core/stats'
import { TS } from './textures'

const TYPE_COLORS = { bottle: 0x6cc7ff, container: 0xff9b2e, net: 0x8fe05a }

export class BoatView {
  readonly container: Phaser.GameObjects.Container
  readonly shadow: Phaser.GameObjects.Image
  private readonly hull: Phaser.GameObjects.Image
  private readonly arms: Phaser.GameObjects.Graphics
  private readonly hold: Phaser.GameObjects.Graphics
  private readonly engines: Phaser.GameObjects.Graphics
  private readonly flame: Phaser.GameObjects.Image
  private upgrades: UpgradeFlags = { cargo: false, engine: false, width: false }
  private full = false
  private cargo: CargoCounts = { bottle: 0, container: 0, net: 0 }
  private capacity: number = BALANCE.cargo.startCapacity

  constructor(private scene: Phaser.Scene, depth: number) {
    this.shadow = scene.add.image(0, 0, 'blob').setScale(1.9, 1.05).setAlpha(0.8).setDepth(depth - 0.1)
    this.arms = scene.add.graphics()
    this.hull = scene.add.image(0, 0, 'boat_hull').setScale(1 / TS)
    this.hold = scene.add.graphics()
    this.engines = scene.add.graphics()
    this.flame = scene.add.image(-40, 0, 'glow').setTint(0xffa43a).setScale(0.3).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD)
    this.container = scene.add.container(0, 0, [this.arms, this.engines, this.hull, this.hold, this.flame]).setDepth(depth)
    this.redrawAll()
  }

  setUpgrades(up: UpgradeFlags, animate = false): void {
    const before = this.upgrades
    this.upgrades = { ...up }
    this.redrawAll()
    if (animate) {
      const popped = (['cargo', 'engine', 'width'] as const).find((k) => up[k] && !before[k])
      const target = popped === 'width' ? this.arms : popped === 'engine' ? this.engines : this.hold
      target.setScale(0.6)
      this.scene.tweens.add({ targets: target, scaleX: 1, scaleY: 1, duration: 520, ease: 'Back.easeOut' })
    }
  }

  setCargo(cargo: CargoCounts, capacity: number): void {
    this.cargo = { ...cargo }
    this.capacity = capacity
    this.full = false
    this.drawHold()
  }

  setFull(full: boolean): void {
    if (this.full === full) return
    this.full = full
    this.drawArms()
  }

  update(x: number, y: number, heading: number, time: number, speedRatio: number, boosting: boolean, turnVel: number): void {
    this.container.setPosition(x, y).setRotation(heading)
    const bob = 1 + Math.sin(time * 0.0032) * 0.012
    this.container.setScale(bob, bob * (1 - Math.min(0.06, Math.abs(turnVel) * 0.03)))
    this.shadow.setPosition(x + 4, y + 7).setRotation(heading)
    this.arms.setAlpha(0.88 + Math.sin(time * 0.004) * 0.12)
    this.flame.setAlpha(boosting ? 0.85 : 0).setScale(boosting ? 0.34 + Math.random() * 0.1 : 0.2)
    void speedRatio
  }

  // ---- drawing --------------------------------------------------------------

  private redrawAll(): void {
    this.drawArms()
    this.drawEngines()
    this.drawHold()
  }

  private armPoint(side: number, t: number, hw: number, len: number): { x: number; y: number } {
    const p0 = { x: 6, y: side * 13 }
    const c = { x: 6 + len * 0.45, y: side * hw * 0.72 }
    const p1 = { x: BALANCE.boat.radius + len, y: side * hw }
    const u = 1 - t
    return {
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    }
  }

  private drawArms(): void {
    const g = this.arms
    g.clear()
    const st = vesselStats(this.upgrades)
    const hw = st.zoneHalfWidth
    const len = st.zoneLength
    const col = this.full ? 0xff6a5a : 0xffffff
    // Zone fill
    g.fillStyle(this.full ? 0xff5a4a : 0xbff7ff, this.full ? 0.2 : 0.13)
    g.beginPath()
    const steps = 10
    for (let i = 0; i <= steps; i++) { const p = this.armPoint(-1, i / steps, hw, len); if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y) }
    for (let i = steps; i >= 0; i--) { const p = this.armPoint(1, i / steps, hw, len); g.lineTo(p.x, p.y) }
    g.closePath(); g.fillPath()
    // Net mesh
    g.lineStyle(1.2, col, 0.28)
    for (const t of [0.35, 0.65, 0.92]) {
      const a = this.armPoint(-1, t, hw, len); const b = this.armPoint(1, t, hw, len)
      g.lineBetween(a.x, a.y, b.x, b.y)
    }
    // Arms
    for (const side of [-1, 1]) {
      g.lineStyle(7, 0x0a3a58, 0.35)
      this.strokeArm(g, side, hw, len)
      g.lineStyle(4.5, col, 1)
      this.strokeArm(g, side, hw, len)
      // floats
      const floats = this.upgrades.width ? 7 : 5
      for (let i = 1; i <= floats; i++) {
        const p = this.armPoint(side, i / floats, hw, len)
        const tip = i === floats
        g.fillStyle(tip ? 0xff5a2a : 0xff9b2e, 1)
        g.fillCircle(p.x, p.y, tip ? 5.2 : 3.2)
        g.fillStyle(0xffffff, 0.8)
        g.fillCircle(p.x - 1, p.y - 1, tip ? 1.8 : 1.1)
      }
    }
    if (this.upgrades.width) {
      // Extra wing rails on the wide arms.
      g.lineStyle(2.2, 0xffd23f, 0.95)
      for (const side of [-1, 1]) {
        const a = this.armPoint(side, 0.5, hw, len); const b = this.armPoint(side, 1, hw, len)
        g.lineBetween(a.x, a.y, b.x, b.y + side * 0)
        g.lineBetween(a.x, a.y + side * -4, b.x, b.y + side * -4)
      }
    }
  }

  private strokeArm(g: Phaser.GameObjects.Graphics, side: number, hw: number, len: number): void {
    g.beginPath()
    for (let i = 0; i <= 12; i++) {
      const p = this.armPoint(side, i / 12, hw, len)
      if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y)
    }
    g.strokePath()
  }

  private drawEngines(): void {
    const g = this.engines
    g.clear()
    const drawMotor = (y: number, big: boolean) => {
      const w = big ? 10 : 8
      const h = big ? 11 : 9
      g.fillStyle(0x000000, 0.2); g.fillRoundedRect(-41, y - h / 2 + 2, w + 2, h, 3)
      g.fillStyle(0x2b3642, 1); g.fillRoundedRect(-41, y - h / 2, w, h, 3)
      g.fillStyle(big ? 0xe83a2a : 0xdfe6ea, 1); g.fillRoundedRect(-40, y - h / 2 + 1.5, w - 3, h - 3, 2)
      if (big) { g.fillStyle(0xffd23f, 1); g.fillRect(-39, y - 0.8, w - 5, 1.6) }
      g.fillStyle(0x9aa7b2, 1); g.fillCircle(-42, y, 1.8)
    }
    if (this.upgrades.engine) {
      drawMotor(-6.5, true)
      drawMotor(6.5, true)
    } else {
      drawMotor(0, false)
    }
  }

  private drawHold(): void {
    const g = this.hold
    g.clear()
    const big = this.upgrades.cargo
    const cols = 3
    const rows = big ? 3 : 2
    const size = big ? 5.4 : 6.2
    const gap = 1.3
    const total = cols * rows
    const used = this.cargo.bottle + this.cargo.container * 2 + this.cargo.net * 4
    const fill = this.capacity > 0 ? used / this.capacity : 0
    const filled = used > 0 ? Math.max(1, Math.round(fill * total)) : 0
    // item colors, one per slot
    const items: number[] = []
    for (let i = 0; i < this.cargo.bottle; i++) items.push(TYPE_COLORS.bottle)
    for (let i = 0; i < this.cargo.container; i++) items.push(TYPE_COLORS.container)
    for (let i = 0; i < this.cargo.net; i++) items.push(TYPE_COLORS.net)
    const startX = -27
    const startY = -((rows * size + (rows - 1) * gap) / 2)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = c * rows + r
        const x = startX + c * (size + gap)
        const y = startY + r * (size + gap)
        g.fillStyle(0xcdbf9a, 1); g.fillRoundedRect(x, y, size, size, 1.2)
        if (idx < filled) {
          const color = items.length ? items[Math.min(items.length - 1, Math.floor((idx * items.length) / Math.max(1, filled)))] : 0xffffff
          g.fillStyle(color, 1); g.fillRoundedRect(x + 0.6, y + 0.6, size - 1.2, size - 1.2, 1)
          g.fillStyle(0xffffff, 0.45); g.fillRect(x + 1.2, y + 1.2, size - 3, 1)
        } else if (big) {
          g.lineStyle(0.8, 0x8a7a50, 0.7); g.strokeRoundedRect(x, y, size, size, 1.2)
        }
      }
    }
    if (big) {
      // cargo upgrade: reinforced side rails
      g.lineStyle(1.6, 0x2fb6c8, 1)
      g.strokeRoundedRect(startX - 2.4, startY - 2.4, cols * (size + gap) + 1.2, rows * (size + gap) + 1.2, 2)
    }
  }
}
