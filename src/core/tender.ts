/**
 * Cargo Tender fleet (pure simulation, no rendering, no player-input coupling).
 *
 * A tender ferries recovered material from the player's hold to the reclamation station:
 *   idle -> toPlayer -> loading -> delivering -> unloading -> returning -> idle
 *
 * Safety rules that the tests pin down:
 *  - Cargo moves in exactly one place per transfer: `takeFromHold` (hold -> tender) and, on delivery, tender -> station.
 *    A tender's cargo is cleared in the same statement that pays out, so it can never pay twice.
 *  - Credits are only paid on delivery (never at dispatch or loading).
 *  - Every tender owns its position, path, cargo and status. Nothing is shared between tenders.
 *  - A tender that cannot make progress re-plans, nudges itself into free water and finally warps to safe water.
 *    Recovery never touches cargo.
 *
 * The movement code (`drive`) only needs a path from `NavGrid` and a speed, so a future Auto Trawler can reuse it.
 */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import { cargoUnits, emptyCargo, type CargoCounts } from './cargo'
import type { NavGrid, Vec } from './nav'
import type { TenderStats } from './stats'
import type { Circle } from './worldgen'

export type TenderStatus = 'idle' | 'toPlayer' | 'loading' | 'delivering' | 'unloading' | 'returning'

/** Player-facing label for each status (unloading is part of delivering). */
export const TENDER_STATUS_LABEL: Record<TenderStatus, string> = {
  idle: 'Available',
  toPlayer: 'Heading to you',
  loading: 'Loading',
  delivering: 'Delivering',
  unloading: 'Delivering',
  returning: 'Returning',
}

export interface Tender {
  readonly id: number
  x: number
  y: number
  heading: number
  /** Scalar speed along the heading (px/s). */
  speed: number
  status: TenderStatus
  cargo: CargoCounts
  path: Vec[]
  /** Seconds spent in the current status. */
  phaseTime: number
  /** Countdown used by loading / unloading. */
  timer: number
  replanTimer: number
  stuckTimer: number
  stuckRef: Vec
  stuckCount: number
  /** Where the current path was aimed, to detect a moving target. */
  pathGoal: Vec | null
  deliveries: number
  recoveries: number
}

export type TenderEvent =
  | { type: 'dispatched'; tender: Tender; auto: boolean }
  | { type: 'loaded'; tender: Tender; counts: CargoCounts; units: number }
  | { type: 'nothingToCarry'; tender: Tender }
  | { type: 'delivered'; tender: Tender; counts: CargoCounts; units: number; credits: number }
  | { type: 'recovered'; tender: Tender; reason: 'stuck' | 'timeout' | 'no-path' }
  | { type: 'status'; tender: Tender; from: TenderStatus; to: TenderStatus }

export interface FleetContext {
  readonly player: { x: number; y: number; vx: number; vy: number; heading: number }
  readonly stats: TenderStats
  /** Whole-item removal from the player's hold, up to `maxUnits`. Must conserve cargo. */
  takeFromHold(maxUnits: number): CargoCounts
  /** Hand cargo to the station. Returns the credits that were paid. */
  deliver(counts: CargoCounts): number
  /** Fraction (0..1) of the player's hold in use. */
  holdFill(): number
  holdUnits(): number
  readonly obstacles: readonly Circle[]
}

export type RequestResult =
  | { ok: true; tender: Tender }
  | { ok: false; reason: 'none' | 'busy' | 'empty' | 'claimed' }

export interface TenderSnapshot {
  id: number
  x: number
  y: number
  heading: number
  status: TenderStatus
  cargo: CargoCounts
  deliveries: number
}

/**
 * Split whole items out of `source`, at most `maxUnits` cargo units, preferring bulky valuable items first.
 * Pure: returns both halves and never creates or destroys items (taken + remaining === source).
 */
export function splitCargo(source: CargoCounts, maxUnits: number): { taken: CargoCounts; remaining: CargoCounts } {
  const taken = emptyCargo()
  const remaining: CargoCounts = { ...source }
  let room = Math.max(0, Math.floor(maxUnits))
  for (const type of ['net', 'container', 'bottle'] as const) {
    const size = BALANCE.debris[type].cargo
    const n = Math.min(remaining[type], Math.floor(room / size))
    taken[type] += n
    remaining[type] -= n
    room -= n * size
  }
  return { taken, remaining }
}

const TRAVEL: ReadonlySet<TenderStatus> = new Set(['toPlayer', 'delivering', 'returning', 'idle'])

export class TenderFleet {
  tenders: Tender[] = []
  private nextId = 1
  private autoCooldown = 0
  private navCache: NavGrid | null = null
  /** Water just outside the station where tenders hand over cargo. */
  private bayCache: Vec | null = null

  constructor(private readonly getNav: () => NavGrid) {}

  private get nav(): NavGrid {
    return (this.navCache ??= this.getNav())
  }

  /** Free water close to the station dock (delivery point). */
  get bay(): Vec {
    if (!this.bayCache) {
      this.bayCache = this.nav.nearestFree(WORLD.dock.x + 40, WORLD.dock.y - 10) ?? { x: WORLD.dock.x + 120, y: WORLD.dock.y }
    }
    return this.bayCache
  }

  get cargoUnits(): number {
    return this.tenders.reduce((s, t) => s + cargoUnits(t.cargo), 0)
  }

  get count(): number {
    return this.tenders.length
  }

  clear(): void {
    this.tenders = []
    this.nextId = 1
    this.autoCooldown = 0
  }

  private create(id: number, x: number, y: number, heading: number): Tender {
    return {
      id,
      x,
      y,
      heading,
      speed: 0,
      status: 'idle',
      cargo: emptyCargo(),
      path: [],
      phaseTime: 0,
      timer: 0,
      replanTimer: 0,
      stuckTimer: 0,
      stuckRef: { x, y },
      stuckCount: 0,
      pathGoal: null,
      deliveries: 0,
      recoveries: 0,
    }
  }

  /** Make the fleet size match the upgrades. New tenders launch from the station. Never removes a tender. */
  sync(count: number): Tender[] {
    const added: Tender[] = []
    while (this.tenders.length < Math.min(count, BALANCE.tender.maxTenders)) {
      const n = this.tenders.length
      const b = this.bay
      const t = this.create(this.nextId++, b.x + n * 36, b.y + n * 22, -0.4)
      this.tenders.push(t)
      added.push(t)
    }
    return added
  }

  // ---- requests --------------------------------------------------------------------------------------------------

  /** Ask for the nearest available tender to come and collect cargo. */
  request(ctx: Pick<FleetContext, 'player' | 'holdUnits'> & { stats?: TenderStats }, auto = false): RequestResult & { events?: TenderEvent[] } {
    if (this.tenders.length === 0) return { ok: false, reason: 'none' }
    if (ctx.holdUnits() <= 0) return { ok: false, reason: 'empty' }
    // Tenders already heading to the player will take this cargo; do not send a second one for nothing.
    if (ctx.stats) {
      const claimed = this.tenders.filter((t) => t.status === 'toPlayer').length * ctx.stats.capacity
      if (claimed > 0 && ctx.holdUnits() <= claimed) return { ok: false, reason: 'claimed' }
    }
    let best: Tender | null = null
    let bestD = Infinity
    for (const t of this.tenders) {
      if (t.status !== 'idle') continue
      const d = Math.hypot(t.x - ctx.player.x, t.y - ctx.player.y)
      if (d < bestD) {
        bestD = d
        best = t
      }
    }
    if (!best) return { ok: false, reason: 'busy' }
    this.setStatus(best, 'toPlayer')
    this.autoCooldown = BALANCE.tender.autoDispatchCooldown
    return { ok: true, tender: best, events: [{ type: 'dispatched', tender: best, auto }] }
  }

  private setStatus(t: Tender, to: TenderStatus, events?: TenderEvent[]): void {
    if (t.status === to) return
    const from = t.status
    t.status = to
    t.phaseTime = 0
    t.path = []
    t.pathGoal = null
    t.replanTimer = 0
    t.stuckTimer = 0
    t.stuckCount = 0
    t.stuckRef = { x: t.x, y: t.y }
    events?.push({ type: 'status', tender: t, from, to })
  }

  // ---- simulation -------------------------------------------------------------------------------------------------

  update(dt: number, ctx: FleetContext): TenderEvent[] {
    const events: TenderEvent[] = []
    if (this.tenders.length === 0) return events
    this.autoCooldown = Math.max(0, this.autoCooldown - dt)

    if (ctx.stats.autoDispatch && this.autoCooldown <= 0 && ctx.holdFill() >= BALANCE.tender.autoDispatchFill) {
      const waiting = this.tenders.some((t) => t.status === 'toPlayer' || t.status === 'loading')
      if (!waiting) {
        const r = this.request(ctx, true)
        if (r.ok && r.events) {
          events.push(...r.events)
          events.push({ type: 'status', tender: r.tender, from: 'idle', to: 'toPlayer' })
        }
      }
    }

    for (const t of this.tenders) this.step(t, dt, ctx, events)
    return events
  }

  private step(t: Tender, dt: number, ctx: FleetContext, events: TenderEvent[]): void {
    const B = BALANCE.tender
    t.phaseTime += dt
    const maxSpeed = ctx.stats.speed
    const player = ctx.player

    switch (t.status) {
      case 'idle': {
        const home = this.followPoint(t, player)
        const d = Math.hypot(t.x - home.x, t.y - home.y)
        if (d > B.followRadius * 0.55) this.travel(t, home, dt, maxSpeed, ctx, events, 40)
        else this.coast(t, dt)
        return
      }
      case 'toPlayer': {
        const lead = 0.5
        const target = { x: player.x + player.vx * lead, y: player.y + player.vy * lead }
        const d = Math.hypot(t.x - player.x, t.y - player.y)
        if (d <= B.transferRange) {
          this.loadFromHold(t, ctx, events)
          return
        }
        this.travel(t, target, dt, maxSpeed, ctx, events, 30)
        return
      }
      case 'loading': {
        this.coast(t, dt)
        t.timer -= dt
        if (t.timer <= 0) this.setStatus(t, cargoUnits(t.cargo) > 0 ? 'delivering' : 'idle', events)
        return
      }
      case 'delivering': {
        const d = Math.hypot(t.x - WORLD.dock.x, t.y - WORLD.dock.y)
        if (d <= B.deliveryRadius) {
          this.setStatus(t, 'unloading', events)
          t.timer = B.unloadSeconds
          return
        }
        this.travel(t, this.bay, dt, maxSpeed, ctx, events, 40)
        return
      }
      case 'unloading': {
        this.coast(t, dt)
        t.timer -= dt
        if (t.timer <= 0) this.completeDelivery(t, ctx, events)
        return
      }
      case 'returning': {
        const home = this.followPoint(t, player)
        const d = Math.hypot(t.x - player.x, t.y - player.y)
        if (d <= B.followRadius) {
          this.setStatus(t, 'idle', events)
          return
        }
        this.travel(t, home, dt, maxSpeed, ctx, events, 40)
        return
      }
    }
  }

  /** Where an idle tender waits: beside and slightly behind the player, one side per tender. */
  private followPoint(t: Tender, player: FleetContext['player']): Vec {
    const slot = this.tenders.indexOf(t)
    const side = slot % 2 === 0 ? -1 : 1
    const back = 70
    const lateral = 95 * side
    const c = Math.cos(player.heading)
    const s = Math.sin(player.heading)
    return { x: player.x - c * back - s * lateral, y: player.y - s * back + c * lateral }
  }

  private loadFromHold(t: Tender, ctx: FleetContext, events: TenderEvent[]): void {
    const taken = ctx.takeFromHold(ctx.stats.capacity)
    const units = cargoUnits(taken)
    if (units <= 0) {
      events.push({ type: 'nothingToCarry', tender: t })
      this.setStatus(t, 'idle', events)
      return
    }
    // Merge in case a tender somehow still holds cargo (e.g. restored mid-trip): never overwrite and lose items.
    t.cargo = { bottle: t.cargo.bottle + taken.bottle, container: t.cargo.container + taken.container, net: t.cargo.net + taken.net }
    this.setStatus(t, 'loading', events)
    t.timer = BALANCE.tender.loadSeconds
    events.push({ type: 'loaded', tender: t, counts: taken, units })
  }

  private completeDelivery(t: Tender, ctx: FleetContext, events: TenderEvent[]): void {
    const counts = t.cargo
    const units = cargoUnits(counts)
    // Clear first, pay second: a tender can never pay the same cargo twice.
    t.cargo = emptyCargo()
    const credits = units > 0 ? ctx.deliver(counts) : 0
    t.deliveries += units > 0 ? 1 : 0
    if (units > 0) events.push({ type: 'delivered', tender: t, counts, units, credits })
    this.setStatus(t, 'returning', events)
  }

  // ---- movement -----------------------------------------------------------------------------------------------------

  private coast(t: Tender, dt: number): void {
    t.speed = Math.max(0, t.speed - BALANCE.tender.accel * 1.4 * dt)
    this.advance(t, dt)
  }

  private advance(t: Tender, dt: number): void {
    t.x += Math.cos(t.heading) * t.speed * dt
    t.y += Math.sin(t.heading) * t.speed * dt
  }

  /** Follow a path to `goal`, re-planning when needed and recovering from stalls. */
  private travel(t: Tender, goal: Vec, dt: number, maxSpeed: number, ctx: FleetContext, events: TenderEvent[], reach: number): void {
    const B = BALANCE.tender
    t.replanTimer -= dt
    const goalMoved = !t.pathGoal || Math.hypot(goal.x - t.pathGoal.x, goal.y - t.pathGoal.y) > 110
    if (t.path.length === 0 || (goalMoved && t.replanTimer <= 0) || t.replanTimer < -3) {
      t.replanTimer = B.replanSeconds
      const route = this.nav.findPath({ x: t.x, y: t.y }, goal)
      t.pathGoal = { x: goal.x, y: goal.y }
      if (route && route.length > 0) t.path = route
      else {
        // No route: aim straight at the goal; stall detection and recovery take over if that fails.
        t.path = [{ x: goal.x, y: goal.y }]
        t.stuckCount += 1
        if (t.stuckCount >= 3) {
          this.recover(t, ctx, events, 'no-path')
          return
        }
      }
    }

    // Steer toward the next waypoint.
    while (t.path.length > 1 && Math.hypot(t.path[0].x - t.x, t.path[0].y - t.y) < 34) t.path.shift()
    const wp = t.path[0]
    const dx = wp.x - t.x
    const dy = wp.y - t.y
    const dist = Math.hypot(dx, dy)
    if (t.path.length === 1 && dist < reach) {
      t.path = []
      this.coast(t, dt)
    } else {
      const want = Math.atan2(dy, dx)
      let diff = want - t.heading
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const maxTurn = B.turnRate * dt
      t.heading += Math.max(-maxTurn, Math.min(maxTurn, diff))
      const align = Math.max(0.3, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)))
      // Ease off near the final waypoint so tenders do not overshoot.
      const arrive = t.path.length === 1 ? Math.min(1, dist / 120 + 0.25) : 1
      const target = maxSpeed * align * arrive
      if (t.speed < target) t.speed = Math.min(target, t.speed + B.accel * dt)
      else t.speed = Math.max(target, t.speed - B.accel * 1.5 * dt)
      this.advance(t, dt)
    }
    this.pushOut(t, ctx.obstacles)
    this.watchProgress(t, dt, ctx, events)
  }

  /** Soft collision: tenders slide off obstacles instead of passing through them. */
  private pushOut(t: Tender, obstacles: readonly Circle[]): void {
    const rad = BALANCE.tender.radius
    for (const o of obstacles) {
      const dx = t.x - o.x
      const dy = t.y - o.y
      const min = o.r + rad
      const d2 = dx * dx + dy * dy
      if (d2 >= min * min) continue
      const d = Math.sqrt(d2) || 0.0001
      t.x = o.x + (dx / d) * min
      t.y = o.y + (dy / d) * min
    }
  }

  private watchProgress(t: Tender, dt: number, ctx: FleetContext, events: TenderEvent[]): void {
    const B = BALANCE.tender
    if (TRAVEL.has(t.status) && t.status !== 'idle' && t.phaseTime > B.phaseTimeout) {
      this.recover(t, ctx, events, 'timeout')
      return
    }
    t.stuckTimer += dt
    if (t.stuckTimer < B.stuckCheckSeconds) return
    const moved = Math.hypot(t.x - t.stuckRef.x, t.y - t.stuckRef.y)
    t.stuckTimer = 0
    t.stuckRef = { x: t.x, y: t.y }
    if (t.path.length === 0 || moved >= B.stuckMinMove) {
      t.stuckCount = 0
      return
    }
    t.stuckCount += 1
    if (t.stuckCount === 1) {
      t.path = [] // re-plan next frame
      t.replanTimer = 0
    } else if (t.stuckCount === 2) {
      const free = this.nav.nearestFree(t.x, t.y)
      if (free) {
        t.x = free.x
        t.y = free.y
      }
      t.path = []
      t.replanTimer = 0
    } else {
      this.recover(t, ctx, events, 'stuck')
    }
  }

  /** Last resort: move to safe water. Cargo, status and credits are untouched. */
  private recover(t: Tender, ctx: FleetContext, events: TenderEvent[], reason: 'stuck' | 'timeout' | 'no-path'): void {
    t.recoveries += 1
    let spot: Vec | null
    if (t.status === 'delivering' || t.status === 'unloading') spot = this.bay
    else spot = this.nav.nearestFree(ctx.player.x, ctx.player.y) ?? this.bay
    t.x = spot.x
    t.y = spot.y
    t.speed = 0
    t.path = []
    t.pathGoal = null
    t.replanTimer = 0
    t.stuckTimer = 0
    t.stuckCount = 0
    t.stuckRef = { x: t.x, y: t.y }
    t.phaseTime = 0
    events.push({ type: 'recovered', tender: t, reason })
  }

  // ---- persistence -----------------------------------------------------------------------------------------------------

  snapshot(): TenderSnapshot[] {
    return this.tenders.map((t) => ({
      id: t.id,
      x: t.x,
      y: t.y,
      heading: t.heading,
      status: t.status,
      cargo: { ...t.cargo },
      deliveries: t.deliveries,
    }))
  }

  /**
   * Restore from a validated snapshot with interruption recovery:
   *  - a tender carrying cargo always resumes delivering it (loading / unloading collapse into "delivering"),
   *  - a tender that had not loaded yet becomes available again (the hold still has its cargo),
   *  - positions on land are moved to free water.
   */
  restore(snaps: readonly TenderSnapshot[]): void {
    this.clear()
    for (const s of snaps.slice(0, BALANCE.tender.maxTenders)) {
      const t = this.create(s.id, s.x, s.y, s.heading)
      this.nextId = Math.max(this.nextId, s.id + 1)
      t.cargo = { ...s.cargo }
      t.deliveries = s.deliveries
      const carrying = cargoUnits(t.cargo) > 0
      t.status = carrying ? 'delivering' : s.status === 'idle' ? 'idle' : 'returning'
      if (!this.nav.isFree(t.x, t.y)) {
        const free = this.nav.nearestFree(t.x, t.y) ?? this.bay
        t.x = free.x
        t.y = free.y
      }
      this.tenders.push(t)
    }
  }
}
