/**
 * Navigation for autonomous vessels (cargo tenders now, auto trawlers later).
 *
 * A coarse grid over the whole bay marks cells that are too close to solid obstacles or the world edge. A* finds a
 * route over free cells, then "string pulling" removes unnecessary waypoints so vessels sail in clean straight
 * lines. Reliability beats sophistication: the grid is built once, and every query returns either a usable path of
 * free-water waypoints or null (callers then use their recovery behaviour).
 */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { Circle } from './worldgen'

export interface Vec {
  x: number
  y: number
}

const SQRT2 = Math.SQRT2

class MinHeap {
  private keys: number[] = []
  private vals: number[] = []
  get size(): number {
    return this.keys.length
  }
  push(key: number, val: number): void {
    const k = this.keys
    const v = this.vals
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): number {
    const k = this.keys
    const v = this.vals
    const top = v[0]
    const lastK = k.pop() as number
    const lastV = v.pop() as number
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = i * 2 + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1] < k[c]) c++
        if (k[c] >= lastK) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lastK
      v[i] = lastV
    }
    return top
  }
}

export class NavGrid {
  readonly cell: number
  readonly cols: number
  readonly rows: number
  private readonly blocked: Uint8Array

  /**
   * @param obstacles solid circles in world space
   * @param clearance distance (px) a vessel centre must keep from any obstacle edge
   */
  constructor(
    obstacles: readonly Circle[],
    clearance: number,
    size: { width: number; height: number } = WORLD,
    cell: number = BALANCE.nav.cell,
  ) {
    this.cell = cell
    this.cols = Math.ceil(size.width / cell)
    this.rows = Math.ceil(size.height / cell)
    this.blocked = new Uint8Array(this.cols * this.rows)
    const half = cell * 0.5
    // Cells whose centre is within clearance (plus half a cell of slack) of an obstacle are blocked.
    for (const o of obstacles) {
      const reach = o.r + clearance + half * 0.8
      const c0 = Math.max(0, Math.floor((o.x - reach) / cell))
      const c1 = Math.min(this.cols - 1, Math.floor((o.x + reach) / cell))
      const r0 = Math.max(0, Math.floor((o.y - reach) / cell))
      const r1 = Math.min(this.rows - 1, Math.floor((o.y + reach) / cell))
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * cell - o.x
          const dy = (r + 0.5) * cell - o.y
          if (dx * dx + dy * dy < reach * reach) this.blocked[r * this.cols + c] = 1
        }
      }
    }
    const edge = BALANCE.boat.edgeMargin + clearance * 0.5
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * cell
        const y = (r + 0.5) * cell
        if (x < edge || y < edge || x > size.width - edge || y > size.height - edge) this.blocked[r * this.cols + c] = 1
      }
    }
  }

  // ---- cell helpers -------------------------------------------------------

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)))
  }
  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)))
  }
  private idx(c: number, r: number): number {
    return r * this.cols + c
  }
  private centerOf(i: number): Vec {
    const c = i % this.cols
    const r = (i - c) / this.cols
    return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell }
  }

  isFree(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.cols * this.cell || y >= this.rows * this.cell) return false
    return this.blocked[this.idx(this.col(x), this.row(y))] === 0
  }

  /** Fraction of cells that are free (diagnostics / tests). */
  get freeRatio(): number {
    let free = 0
    for (let i = 0; i < this.blocked.length; i++) if (!this.blocked[i]) free++
    return free / this.blocked.length
  }

  /** Nearest free water to a point (searching outwards in rings), or null if nothing is free nearby. */
  nearestFree(x: number, y: number, maxRings = 60): Vec | null {
    const c0 = this.col(x)
    const r0 = this.row(y)
    if (!this.blocked[this.idx(c0, r0)]) return { x, y: y }
    let best: Vec | null = null
    let bestD = Infinity
    for (let ring = 1; ring <= maxRings; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue
          const c = c0 + dc
          const r = r0 + dr
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue
          if (this.blocked[this.idx(c, r)]) continue
          const p = this.centerOf(this.idx(c, r))
          const d = (p.x - x) ** 2 + (p.y - y) ** 2
          if (d < bestD) {
            bestD = d
            best = p
          }
        }
      }
      // Once a ring has produced a candidate, one more ring can still be closer diagonally; check it, then stop.
      if (best && ring >= 2) {
        const reached = Math.sqrt(bestD)
        if (reached <= ring * this.cell) break
      }
    }
    return best
  }

  /** True when the straight segment a->b stays on free cells. */
  lineClear(a: Vec, b: Vec): boolean {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.4)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      if (!this.isFree(a.x + dx * t, a.y + dy * t)) return false
    }
    return true
  }

  // ---- pathfinding ---------------------------------------------------------

  /**
   * Route from `from` to `to`. Endpoints inside blocked cells are moved to the nearest free water first.
   * Returns waypoints (excluding `from`) or null if no route exists.
   */
  findPath(from: Vec, to: Vec): Vec[] | null {
    const start = this.nearestFree(from.x, from.y)
    const goal = this.nearestFree(to.x, to.y)
    if (!start || !goal) return null
    const sc = this.col(start.x)
    const sr = this.row(start.y)
    const gc = this.col(goal.x)
    const gr = this.row(goal.y)
    const s = this.idx(sc, sr)
    const g = this.idx(gc, gr)
    const goalPoint = this.isFree(to.x, to.y) ? { x: to.x, y: to.y } : goal
    if (s === g) return [goalPoint]

    const n = this.cols * this.rows
    const gScore = new Float32Array(n).fill(Infinity)
    const parent = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const heap = new MinHeap()
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - gc)
      const dy = Math.abs(r - gr)
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy)
    }
    gScore[s] = 0
    heap.push(h(sc, sr), s)
    let found = false
    while (heap.size > 0) {
      const cur = heap.pop()
      if (closed[cur]) continue
      closed[cur] = 1
      if (cur === g) {
        found = true
        break
      }
      const cc = cur % this.cols
      const cr = (cur - cc) / this.cols
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dc === 0 && dr === 0) continue
          const nc = cc + dc
          const nr = cr + dr
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue
          const ni = this.idx(nc, nr)
          if (this.blocked[ni] || closed[ni]) continue
          // No corner cutting.
          if (dc !== 0 && dr !== 0 && (this.blocked[this.idx(cc + dc, cr)] || this.blocked[this.idx(cc, cr + dr)])) continue
          const cost = gScore[cur] + (dc !== 0 && dr !== 0 ? SQRT2 : 1)
          if (cost < gScore[ni]) {
            gScore[ni] = cost
            parent[ni] = cur
            heap.push(cost + h(nc, nr), ni)
          }
        }
      }
    }
    if (!found) return null

    const cells: Vec[] = []
    for (let i = g; i !== -1; i = parent[i]) cells.push(this.centerOf(i))
    cells.reverse()
    cells[0] = { x: start.x, y: start.y }
    cells[cells.length - 1] = goalPoint
    return this.smooth(cells).slice(1)
  }

  /** String pulling: keep only the waypoints needed to avoid obstacles. */
  private smooth(points: Vec[]): Vec[] {
    if (points.length <= 2) return points
    const out: Vec[] = [points[0]]
    let anchor = 0
    while (anchor < points.length - 1) {
      let far = points.length - 1
      while (far > anchor + 1 && !this.lineClear(points[anchor], points[far])) far--
      out.push(points[far])
      anchor = far
    }
    return out
  }
}
