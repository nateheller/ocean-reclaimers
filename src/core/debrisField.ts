/**
 * The live set of floating debris: a coarse spatial grid plus per-patch aggregates.
 *
 * Everything that needs to know "what is still in the water" (autonomous trawlers, sonar, late-game assistance) asks
 * this one object, so removing an item in one place is instantly visible everywhere. Queries never scan the whole map:
 * `nearest` walks outward ring by ring through grid cells and stops as soon as nothing closer can exist.
 */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { DebrisSpawn } from './worldgen'

/** What is left of one debris patch. */
export interface Concentration {
  readonly patch: string
  /** Centroid of the remaining items. */
  readonly x: number
  readonly y: number
  /** Radius of the remaining items around the centroid (px). */
  readonly radius: number
  readonly items: number
  /** Remaining cargo units (bottle 1, container 2, net 4). */
  readonly units: number
}

export interface NearestOptions {
  maxDist?: number
  /** Return false to skip an item (claimed by another vessel, does not fit, ...). */
  accept?: (s: DebrisSpawn) => boolean
}

export class DebrisField {
  /** Bumped on every change; lets callers cache derived data (e.g. concentrations). */
  version = 0

  private readonly byId = new Map<number, DebrisSpawn>()
  private readonly cells: Set<DebrisSpawn>[]
  private readonly cols: number
  private readonly rows: number
  private readonly patches = new Map<string, Set<DebrisSpawn>>()
  private readonly remaining = new Set<number>()
  private unitsLeft = 0
  private cachedAt = -1
  private cached: Concentration[] = []

  constructor(readonly spawns: readonly DebrisSpawn[], private readonly cell = 300) {
    this.cols = Math.ceil(WORLD.width / cell)
    this.rows = Math.ceil(WORLD.height / cell)
    this.cells = Array.from({ length: this.cols * this.rows }, () => new Set<DebrisSpawn>())
    for (const s of spawns) this.byId.set(s.id, s)
    this.reset()
  }

  private cellIndex(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)))
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)))
    return r * this.cols + c
  }

  /** Put every item back in the water. */
  reset(): void {
    for (const set of this.cells) set.clear()
    this.patches.clear()
    this.remaining.clear()
    this.unitsLeft = 0
    for (const s of this.spawns) {
      this.cells[this.cellIndex(s.x, s.y)].add(s)
      let p = this.patches.get(s.patch)
      if (!p) this.patches.set(s.patch, (p = new Set()))
      p.add(s)
      this.remaining.add(s.id)
      this.unitsLeft += BALANCE.debris[s.type].cargo
    }
    this.version++
  }

  get count(): number {
    return this.remaining.size
  }

  /** Cargo units still floating. */
  get units(): number {
    return this.unitsLeft
  }

  has(id: number): boolean {
    return this.remaining.has(id)
  }

  get(id: number): DebrisSpawn | undefined {
    return this.byId.get(id)
  }

  /** Remove an item from the water. Returns false (and changes nothing) if it was already gone. */
  remove(id: number): boolean {
    if (!this.remaining.delete(id)) return false
    const s = this.byId.get(id)
    if (!s) return false
    this.cells[this.cellIndex(s.x, s.y)].delete(s)
    this.patches.get(s.patch)?.delete(s)
    this.unitsLeft -= BALANCE.debris[s.type].cargo
    this.version++
    return true
  }

  /** Mark exactly these ids as already collected (used when loading a save). */
  restore(removedIds: Iterable<number>): void {
    this.reset()
    for (const id of removedIds) this.remove(id)
  }

  /** Every remaining item, in id order. */
  all(): DebrisSpawn[] {
    const out: DebrisSpawn[] = []
    for (const s of this.spawns) if (this.remaining.has(s.id)) out.push(s)
    return out
  }

  /** Call `fn` for every remaining item within `r` px of (x, y). */
  forEachNear(x: number, y: number, r: number, fn: (s: DebrisSpawn) => void): void {
    const c0 = Math.max(0, Math.floor((x - r) / this.cell))
    const c1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cell))
    const r0 = Math.max(0, Math.floor((y - r) / this.cell))
    const r1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cell))
    const r2 = r * r
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (const s of this.cells[row * this.cols + col]) {
          const dx = s.x - x
          const dy = s.y - y
          if (dx * dx + dy * dy <= r2) fn(s)
        }
      }
    }
  }

  /**
   * The closest acceptable item to (x, y), or null. `cost` lets the caller bias the choice (e.g. route efficiency);
   * it defaults to plain distance. Ties go to the lower id so the answer is deterministic.
   */
  nearest(x: number, y: number, opts: NearestOptions = {}, cost?: (s: DebrisSpawn, dist: number) => number): DebrisSpawn | null {
    const maxDist = opts.maxDist ?? Infinity
    const accept = opts.accept
    const c0 = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)))
    const r0 = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)))
    const maxRing = Math.max(this.cols, this.rows)
    let best: DebrisSpawn | null = null
    let bestCost = Infinity
    let bestDist = Infinity
    for (let ring = 0; ring <= maxRing; ring++) {
      // Nothing in this ring or beyond can be nearer than (ring - 1) cells.
      const ringMin = Math.max(0, (ring - 1) * this.cell)
      if (ringMin > maxDist) break
      // With a custom cost the cheapest item may be a little farther than the nearest one; keep looking a bit more.
      if (best && ringMin > bestDist + (cost ? 600 : 0)) break
      for (let dr = -ring; dr <= ring; dr++) {
        const row = r0 + dr
        if (row < 0 || row >= this.rows) continue
        const edgeRow = Math.abs(dr) === ring
        for (let dc = -ring; dc <= ring; dc += edgeRow ? 1 : ring * 2 || 1) {
          const col = c0 + dc
          if (col < 0 || col >= this.cols) continue
          for (const s of this.cells[row * this.cols + col]) {
            const d = Math.hypot(s.x - x, s.y - y)
            if (d > maxDist) continue
            if (accept && !accept(s)) continue
            const c = cost ? cost(s, d) : d
            if (c < bestCost || (c === bestCost && best && s.id < best.id)) {
              best = s
              bestCost = c
              bestDist = d
            }
          }
        }
      }
    }
    return best
  }

  /** What remains of each patch (empty patches omitted). Cached until the field changes. */
  concentrations(): readonly Concentration[] {
    if (this.cachedAt === this.version) return this.cached
    const out: Concentration[] = []
    for (const [patch, set] of this.patches) {
      if (set.size === 0) continue
      let sx = 0
      let sy = 0
      let units = 0
      for (const s of set) {
        sx += s.x
        sy += s.y
        units += BALANCE.debris[s.type].cargo
      }
      const x = sx / set.size
      const y = sy / set.size
      let radius = 0
      for (const s of set) radius = Math.max(radius, Math.hypot(s.x - x, s.y - y))
      out.push({ patch, x, y, radius: radius + 40, items: set.size, units })
    }
    this.cached = out
    this.cachedAt = this.version
    return out
  }
}
