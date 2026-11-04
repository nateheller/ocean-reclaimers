/** Marine wildlife that drifts through Coral Bay and returns as the water clears. */
import Phaser from 'phaser'
import { WORLD } from '../config/world'
import { hashSeed, Rng } from '../core/rng'

interface Area { x0: number; x1: number; y0: number; y1: number }

interface TierDef {
  schools: number
  turtles: number
  dolphins: number
  mantas: number
  whales: number
  area: Area
}

/** Tier 0 is present from the start (hidden in murky water); 1-3 appear at 25/50/75%. */
const TIERS: TierDef[] = [
  { schools: 3, turtles: 0, dolphins: 0, mantas: 0, whales: 0, area: { x0: 800, x1: 2400, y0: 2300, y1: 3400 } },
  { schools: 3, turtles: 1, dolphins: 0, mantas: 0, whales: 0, area: { x0: 800, x1: 3200, y0: 1800, y1: 3400 } },
  { schools: 3, turtles: 1, dolphins: 2, mantas: 0, whales: 0, area: { x0: 800, x1: 4200, y0: 1200, y1: 3400 } },
  { schools: 4, turtles: 1, dolphins: 0, mantas: 1, whales: 1, area: { x0: 600, x1: 5000, y0: 400, y1: 3400 } },
]

const FISH_KEYS = ['fish_orange', 'fish_blue', 'fish_yellow']

type Kind = 'school' | 'turtle' | 'dolphin' | 'manta' | 'whale'

interface Animal {
  kind: Kind
  x: number
  y: number
  heading: number
  speed: number
  tx: number
  ty: number
  sprites: Phaser.GameObjects.Image[]
  offsets: { x: number; y: number; ph: number }[]
  phase: number
  area: Area
  /** Dolphin leap timer / progress */
  leapIn: number
  leapT: number
  turnRate: number
}

export class Wildlife {
  private animals: Animal[] = []
  private rng: Rng
  private tiersAdded = new Set<number>()
  /** Called when a dolphin breaks the surface so the scene can add a splash. */
  onSplash: ((x: number, y: number, big: boolean) => void) | null = null

  constructor(private scene: Phaser.Scene, private depth: number, private topDepth: number) {
    this.rng = new Rng(hashSeed(WORLD.seed, 'wildlife'))
  }

  get count(): number {
    return this.animals.length
  }

  reset(): void {
    for (const a of this.animals) a.sprites.forEach((s) => s.destroy())
    this.animals = []
    this.tiersAdded.clear()
  }

  /** Make sure every tier up to `tier` exists. */
  ensureTier(tier: number, instant: boolean): boolean {
    let added = false
    for (let t = 0; t <= tier; t++) {
      if (this.tiersAdded.has(t)) continue
      this.tiersAdded.add(t)
      this.spawnTier(t, instant)
      added = true
    }
    return added
  }

  private spawnTier(t: number, instant: boolean): void {
    const def = TIERS[t]
    const rng = new Rng(hashSeed(WORLD.seed, 'tier', t))
    const pos = () => ({ x: rng.range(def.area.x0, def.area.x1), y: rng.range(def.area.y0, def.area.y1) })
    for (let i = 0; i < def.schools; i++) this.make('school', pos(), def.area, rng, instant)
    for (let i = 0; i < def.turtles; i++) this.make('turtle', pos(), def.area, rng, instant)
    for (let i = 0; i < def.dolphins; i++) this.make('dolphin', pos(), def.area, rng, instant)
    for (let i = 0; i < def.mantas; i++) this.make('manta', pos(), def.area, rng, instant)
    for (let i = 0; i < def.whales; i++) this.make('whale', pos(), def.area, rng, instant)
  }

  private make(kind: Kind, p: { x: number; y: number }, area: Area, rng: Rng, instant: boolean): void {
    const sprites: Phaser.GameObjects.Image[] = []
    const offsets: Animal['offsets'] = []
    const add = (key: string, scale: number, depth = this.depth) => {
      const s = this.scene.add.image(p.x, p.y, key).setScale(scale / 2).setDepth(depth)
      s.setAlpha(instant ? 1 : 0)
      if (!instant) this.scene.tweens.add({ targets: s, alpha: 1, duration: 2500 })
      sprites.push(s)
      return s
    }
    let speed = 60
    let turnRate = 1.4
    if (kind === 'school') {
      const key = FISH_KEYS[rng.int(0, FISH_KEYS.length - 1)]
      const n = rng.int(6, 9)
      for (let i = 0; i < n; i++) {
        add(key, 0.8 + rng.range(-0.1, 0.15))
        offsets.push({ x: rng.range(-34, 34), y: rng.range(-24, 24), ph: rng.range(0, 6.28) })
      }
      speed = rng.range(45, 70)
    } else if (kind === 'turtle') {
      add('turtle', 1)
      speed = 26
      turnRate = 0.7
    } else if (kind === 'dolphin') {
      // dolphins travel as a pair
      add('dolphin', 1); add('dolphin', 0.85)
      offsets.push({ x: 0, y: 0, ph: 0 }, { x: -34, y: 30, ph: 1 })
      speed = 120
      turnRate = 1.1
    } else if (kind === 'manta') {
      add('manta', 1.2)
      speed = 52
      turnRate = 0.6
    } else {
      add('whale', 1)
      speed = 34
      turnRate = 0.35
    }
    this.animals.push({
      kind, x: p.x, y: p.y, heading: rng.range(0, Math.PI * 2), speed, tx: p.x, ty: p.y,
      sprites, offsets, phase: rng.range(0, 10), area, leapIn: rng.range(4, 10), leapT: -1, turnRate,
    })
    this.pickTarget(this.animals[this.animals.length - 1])
  }

  private pickTarget(a: Animal): void {
    const ang = a.heading + this.rng.range(-1.2, 1.2)
    const dist = this.rng.range(300, 700)
    a.tx = Phaser.Math.Clamp(a.x + Math.cos(ang) * dist, a.area.x0 - 300, a.area.x1 + 300)
    a.ty = Phaser.Math.Clamp(a.y + Math.sin(ang) * dist, a.area.y0 - 300, a.area.y1 + 300)
    a.tx = Phaser.Math.Clamp(a.tx, 150, WORLD.width - 150)
    a.ty = Phaser.Math.Clamp(a.ty, 150, WORLD.height - 150)
  }

  update(dt: number, time: number, boatX: number, boatY: number): void {
    for (const a of this.animals) {
      a.phase += dt
      // Steering toward the waypoint.
      let want = Math.atan2(a.ty - a.y, a.tx - a.x)
      let speed = a.speed
      const bd = Math.hypot(a.x - boatX, a.y - boatY)
      const scareR = a.kind === 'whale' ? 150 : a.kind === 'school' ? 200 : 170
      if (bd < scareR) {
        want = Math.atan2(a.y - boatY, a.x - boatX)
        speed *= a.kind === 'school' ? 2.6 : 1.8
      }
      const diff = Phaser.Math.Angle.Wrap(want - a.heading)
      const maxTurn = a.turnRate * dt * (bd < scareR ? 2.5 : 1)
      a.heading += Phaser.Math.Clamp(diff, -maxTurn, maxTurn)
      a.x += Math.cos(a.heading) * speed * dt
      a.y += Math.sin(a.heading) * speed * dt
      if (Math.hypot(a.tx - a.x, a.ty - a.y) < 60) this.pickTarget(a)

      const c = Math.cos(a.heading)
      const s = Math.sin(a.heading)
      if (a.kind === 'school') {
        a.sprites.forEach((spr, i) => {
          const o = a.offsets[i]
          const wob = Math.sin(a.phase * 1.7 + o.ph)
          const lx = o.x + Math.sin(a.phase * 0.9 + o.ph) * 6
          const ly = o.y + wob * 5
          spr.setPosition(a.x + c * lx - s * ly, a.y + s * lx + c * ly)
          spr.setRotation(a.heading + wob * 0.18)
        })
      } else if (a.kind === 'dolphin') {
        a.leapIn -= dt
        if (a.leapIn <= 0 && a.leapT < 0) {
          a.leapT = 0
          a.leapIn = this.rng.range(9, 16)
          this.onSplash?.(a.x, a.y, true)
        }
        let lift = 0
        if (a.leapT >= 0) {
          a.leapT += dt / 1.0
          lift = Math.sin(Math.min(1, a.leapT) * Math.PI)
          if (a.leapT >= 1) {
            a.leapT = -1
            this.onSplash?.(a.x, a.y, true)
          }
        }
        a.sprites.forEach((spr, i) => {
          const o = a.offsets[i]
          spr.setPosition(a.x + c * o.x - s * o.y, a.y + s * o.x + c * o.y)
          spr.setRotation(a.heading + Math.sin(a.phase * 3 + i) * 0.05)
          const sc = (i === 0 ? 0.5 : 0.425) * (1 + (i === 0 ? lift * 0.45 : 0))
          spr.setScale(sc)
          spr.setDepth(i === 0 && lift > 0.05 ? this.topDepth : this.depth)
        })
      } else {
        const spr = a.sprites[0]
        spr.setPosition(a.x, a.y)
        const sway = a.kind === 'turtle' ? Math.sin(a.phase * 1.6) * 0.06 : a.kind === 'manta' ? 0 : Math.sin(a.phase * 0.8) * 0.03
        spr.setRotation(a.heading + sway)
        if (a.kind === 'manta') spr.setScale(0.6 * (1 + Math.sin(a.phase * 1.8) * 0.03), 0.6 * (1 + Math.sin(a.phase * 1.8 + 1.5) * 0.06))
      }
    }
    void time
  }
}
