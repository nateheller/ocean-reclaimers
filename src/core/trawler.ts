/**
 * Autonomous Cleanup Trawlers (pure simulation, no rendering).
 *
 * Unlike cargo tenders (which ferry cargo out of the player's hold), a trawler scoops floating debris straight out of
 * the water into its own small hold, carries it home, and is paid for it at the station:
 *
 *   departing -> searching <-> collecting -> returning -> unloading -> departing ...
 *
 * Rules the tests pin down:
 *  - Debris leaves the water in exactly one place: `ctx.collect(id)`. It returns false if the item is already gone, so
 *    nothing is ever scooped twice and cleanup progress is never double counted.
 *  - Credits are paid only on delivery. A trawler's hold is emptied in the same statement that pays out.
 *  - A trawler "claims" the item it is heading for; no other trawler picks a claimed item, and the claim is dropped as
 *    soon as the item is collected, vanishes or proves unreachable.
 *  - Items that cannot be reached are remembered and skipped, so a trawler can never loop on them forever.
 *  - Every trawler owns its position, route and cargo. A trawler that makes no progress for a long time warps to safe
 *    water; recovery never touches cargo or credits.
 *  - Nothing here is random: the same world and the same purchases always produce the same behaviour.
 *  - Trawlers earn cleanup progress and credits only. They never touch the arcade score or the combo.
 */
import { BALANCE, type DebrisType } from '../config/balance'
import { WORLD } from '../config/world'
import { cargoUnits, emptyCargo, type CargoCounts } from './cargo'
import type { DebrisField } from './debrisField'
import type { NavGrid, Vec } from './nav'
import type { TrawlerStats } from './stats'
import { coast, drive, newMover, resetRoute, steerDirect, warp, type MotionParams, type Mover } from './vesselMotion'
import type { Circle, DebrisSpawn } from './worldgen'

export type TrawlerStatus = 'searching' | 'collecting' | 'returning' | 'unloading' | 'departing'

export const TRAWLER_STATUS_LABEL: Record<TrawlerStatus, string> = {
  searching: 'Searching',
  collecting: 'Collecting',
  returning: 'Returning',
  unloading: 'Unloading',
  departing: 'Departing',
}

export interface Trawler extends Mover {
  readonly id: number
  status: TrawlerStatus
  cargo: CargoCounts
  /** Debris id this trawler has claimed, or null. */
  target: number | null
  /** Seconds spent scooping the current target. */
  gather: number
  /** Seconds spent on the final approach to the current target. */
  approachTime: number
  /** Countdown used by unloading / departing / idle retries. */
  timer: number
  /** Seconds since the last useful event (a pickup, a delivery, a departure); the watchdog for "permanently stuck". */
  idleTime: number
  deliveries: number
  collected: number
  recoveries: number
}

export type TrawlerEvent =
  | { type: 'launched'; trawler: Trawler }
  | { type: 'targeted'; trawler: Trawler; spawn: DebrisSpawn }
  | { type: 'collected'; trawler: Trawler; spawn: DebrisSpawn; units: number }
  | { type: 'delivered'; trawler: Trawler; counts: CargoCounts; units: number; credits: number }
  | { type: 'gaveUp'; trawler: Trawler; spawn: DebrisSpawn }
  | { type: 'status'; trawler: Trawler; from: TrawlerStatus; to: TrawlerStatus }
  | { type: 'recovered'; trawler: Trawler; reason: 'stuck' | 'timeout' | 'no-path' }

export interface TrawlerContext {
  readonly stats: TrawlerStats
  readonly field: DebrisField
  readonly obstacles: readonly Circle[]
  /** Take an item out of the water. Must return false (and do nothing) if it was already collected. */
  collect(id: number): boolean
  /** Pay for delivered cargo. Returns the credits paid. */
  deliver(counts: CargoCounts): number
  /** Where the player's boat is. Trawlers leave the plastic right around it for the player to collect. */
  readonly player?: { readonly x: number; readonly y: number }
}

export interface TrawlerSnapshot {
  id: number
  x: number
  y: number
  heading: number
  status: TrawlerStatus
  cargo: CargoCounts
  deliveries: number
  collected: number
}

const MOTION: MotionParams = {
  accel: BALANCE.trawler.accel,
  turnRate: BALANCE.trawler.turnRate,
  radius: BALANCE.trawler.radius,
  replanSeconds: BALANCE.trawler.replanSeconds,
  stuckCheckSeconds: BALANCE.trawler.stuckCheckSeconds,
  stuckMinMove: BALANCE.trawler.stuckMinMove,
}

const unitsOf = (type: DebrisType) => BALANCE.debris[type].cargo

export class TrawlerFleet {
  trawlers: Trawler[] = []
  private nextId = 1
  /** item id -> trawler id. */
  private readonly claims = new Map<number, number>()
  /** Items no trawler could reach; left for the player. */
  private readonly unreachable = new Set<number>()
  private navCache: NavGrid | null = null
  private bayCache: Vec | null = null

  constructor(private readonly getNav: () => NavGrid) {}

  private get nav(): NavGrid {
    return (this.navCache ??= this.getNav())
  }

  /** Free water just outside the station where trawlers hand over cargo. */
  get bay(): Vec {
    if (!this.bayCache) {
      this.bayCache = this.nav.nearestFree(WORLD.dock.x + 40, WORLD.dock.y - 10) ?? { x: WORLD.dock.x + 120, y: WORLD.dock.y }
    }
    return this.bayCache
  }

  get count(): number {
    return this.trawlers.length
  }

  get cargoUnits(): number {
    return this.trawlers.reduce((s, t) => s + cargoUnits(t.cargo), 0)
  }

  /** Items currently claimed (exposed for tests). */
  claimedIds(): number[] {
    return [...this.claims.keys()]
  }

  unreachableIds(): number[] {
    return [...this.unreachable]
  }

  clear(): void {
    this.trawlers = []
    this.nextId = 1
    this.claims.clear()
    this.unreachable.clear()
  }

  private create(id: number, x: number, y: number, heading: number): Trawler {
    return {
      ...newMover(x, y, heading),
      id,
      status: 'departing',
      cargo: emptyCargo(),
      target: null,
      gather: 0,
      approachTime: 0,
      timer: BALANCE.trawler.departSeconds,
      idleTime: 0,
      deliveries: 0,
      collected: 0,
      recoveries: 0,
    }
  }

  /** Make the fleet size match the upgrades. New trawlers launch from the station. Never removes a trawler. */
  sync(count: number): Trawler[] {
    const added: Trawler[] = []
    while (this.trawlers.length < Math.min(count, BALANCE.trawler.maxTrawlers)) {
      const n = this.trawlers.length
      const b = this.bay
      const t = this.create(this.nextId++, b.x + n * 40, b.y + 30 + n * 26, -0.5)
      this.trawlers.push(t)
      added.push(t)
    }
    return added
  }

  // ---- simulation ------------------------------------------------------------------------------------------------

  update(dt: number, ctx: TrawlerContext): TrawlerEvent[] {
    const events: TrawlerEvent[] = []
    for (const t of this.trawlers) this.step(t, dt, ctx, events)
    return events
  }

  private setStatus(t: Trawler, to: TrawlerStatus, events?: TrawlerEvent[]): void {
    if (t.status === to) return
    const from = t.status
    t.status = to
    resetRoute(t)
    events?.push({ type: 'status', trawler: t, from, to })
  }

  private release(t: Trawler): void {
    if (t.target !== null && this.claims.get(t.target) === t.id) this.claims.delete(t.target)
    t.target = null
    t.gather = 0
    t.approachTime = 0
  }

  private step(t: Trawler, dt: number, ctx: TrawlerContext, events: TrawlerEvent[]): void {
    const B = BALANCE.trawler
    t.idleTime += dt
    if (t.idleTime > B.phaseTimeout) {
      // Watchdog: nothing useful has happened for a long time. Give up on the target and start over from the station.
      if (t.target !== null) this.giveUp(t, ctx, events)
      this.recover(t, ctx, events, 'timeout')
    }

    switch (t.status) {
      case 'departing': {
        t.timer -= dt
        const slot = this.trawlers.indexOf(t)
        const out = this.nav.nearestFree(this.bay.x + 150, this.bay.y - 70 + slot * 130) ?? this.bay
        const r = drive(t, out, dt, this.nav, ctx.obstacles, ctx.stats.speed, 50, MOTION)
        if (r === 'stalled' || r === 'unroutable') this.recover(t, ctx, events, r === 'stalled' ? 'stuck' : 'no-path')
        if (t.timer <= 0 || r === 'arrived') {
          t.idleTime = 0
          t.timer = 0
          this.setStatus(t, 'searching', events)
        }
        return
      }
      case 'searching':
      case 'collecting':
        this.hunt(t, dt, ctx, events)
        return
      case 'returning': {
        const d = Math.hypot(t.x - WORLD.dock.x, t.y - WORLD.dock.y)
        if (d <= B.deliveryRadius) {
          this.setStatus(t, 'unloading', events)
          t.timer = ctx.stats.unloadSeconds
          return
        }
        const r = drive(t, this.bay, dt, this.nav, ctx.obstacles, ctx.stats.speed, 40, MOTION)
        if (r === 'stalled' || r === 'unroutable') this.recover(t, ctx, events, r === 'stalled' ? 'stuck' : 'no-path')
        return
      }
      case 'unloading': {
        coast(t, dt, MOTION.accel)
        t.timer -= dt
        if (t.timer <= 0) this.completeDelivery(t, ctx, events)
        return
      }
    }
  }

  // ---- hunting ---------------------------------------------------------------------------------------------------

  private hunt(t: Trawler, dt: number, ctx: TrawlerContext, events: TrawlerEvent[]): void {
    const used = cargoUnits(t.cargo)
    const free = ctx.stats.capacity - used

    // Hold full (or too full for anything we know of): head home.
    if (free <= 0) {
      this.goHome(t, events)
      return
    }

    // Validate the current target: it must still be in the water, still ours, and still fit.
    if (t.target !== null) {
      const s = ctx.field.get(t.target)
      if (!s || !ctx.field.has(t.target) || this.claims.get(t.target) !== t.id || unitsOf(s.type) > free) this.release(t)
    }

    if (t.target === null) {
      // An idle trawler re-checks only every so often, so waiting costs next to nothing.
      if (t.timer > 0) {
        t.timer -= dt
        coast(t, dt, MOTION.accel)
        return
      }
      const pick = this.pickTarget(t, free, ctx)
      if (!pick) {
        if (used > 0) {
          this.goHome(t, events)
          return
        }
        // Empty and nothing reachable anywhere: wait at sea and look again shortly.
        this.setStatus(t, 'searching', events)
        t.timer = BALANCE.trawler.retrySeconds
        t.idleTime = 0 // waiting with nothing left to collect is not "stuck"
        coast(t, dt, MOTION.accel)
        return
      }
      t.target = pick.id
      this.claims.set(pick.id, t.id)
      t.gather = 0
      t.approachTime = 0
      resetRoute(t)
      events.push({ type: 'targeted', trawler: t, spawn: pick })
    }

    const spawn = ctx.field.get(t.target) as DebrisSpawn
    const d = Math.hypot(spawn.x - t.x, spawn.y - t.y)
    this.setStatus(t, d <= BALANCE.trawler.collectingWithin ? 'collecting' : 'searching', events)

    // Scooping: close enough to take it.
    if (d <= ctx.stats.collectRadius) {
      coast(t, dt, MOTION.accel)
      t.gather += dt
      if (t.gather >= ctx.stats.collectSeconds) this.scoop(t, spawn, ctx, events)
      return
    }
    t.gather = 0

    // Final approach: leave the route and head straight for the item.
    if (d <= BALANCE.trawler.approachRadius) {
      t.approachTime += dt
      steerDirect(t, spawn, dt, ctx.obstacles, ctx.stats.speed, MOTION)
      if (t.approachTime > BALANCE.trawler.approachTimeout) this.giveUp(t, ctx, events)
      return
    }

    const r = drive(t, spawn, dt, this.nav, ctx.obstacles, ctx.stats.speed, ctx.stats.collectRadius * 0.7, MOTION)
    if (r === 'arrived') {
      // The route ended but the item is still out of reach (it sits in a cell the planner treats as blocked).
      if (Math.hypot(spawn.x - t.x, spawn.y - t.y) > BALANCE.trawler.approachRadius) this.giveUp(t, ctx, events)
    } else if (r === 'stalled' || r === 'unroutable') {
      this.giveUp(t, ctx, events)
      this.recover(t, ctx, events, r === 'stalled' ? 'stuck' : 'no-path')
    }
  }

  /** Cheapest acceptable item: nearest first, with the route-efficiency bias at higher levels. */
  private pickTarget(t: Trawler, free: number, ctx: TrawlerContext): DebrisSpawn | null {
    const yieldR = BALANCE.trawler.yieldToPlayerRadius
    const p = ctx.player
    const accept = (s: DebrisSpawn) =>
      !this.claims.has(s.id) &&
      !this.unreachable.has(s.id) &&
      unitsOf(s.type) <= free &&
      !(p && yieldR > 0 && Math.hypot(s.x - p.x, s.y - p.y) < yieldR)
    const bias = ctx.stats.routeBias
    const cost = bias > 0 ? (s: DebrisSpawn, d: number) => d + bias * Math.hypot(s.x - WORLD.dock.x, s.y - WORLD.dock.y) : undefined
    const near = ctx.field.nearest(t.x, t.y, { maxDist: ctx.stats.detectRange, accept }, cost)
    if (near) return near
    // Nothing nearby. An empty trawler goes farther afield rather than idling; a loaded one heads home instead.
    if (cargoUnits(t.cargo) === 0) return ctx.field.nearest(t.x, t.y, { accept }, cost)
    return null
  }

  private scoop(t: Trawler, spawn: DebrisSpawn, ctx: TrawlerContext, events: TrawlerEvent[]): void {
    const id = spawn.id
    this.release(t)
    // The one place debris leaves the water for a trawler. False means someone else got there first.
    if (!ctx.collect(id)) return
    t.cargo = { ...t.cargo, [spawn.type]: t.cargo[spawn.type] + 1 }
    t.collected += 1
    t.idleTime = 0
    events.push({ type: 'collected', trawler: t, spawn, units: unitsOf(spawn.type) })
  }

  private giveUp(t: Trawler, ctx: TrawlerContext, events: TrawlerEvent[]): void {
    if (t.target === null) return
    const s = ctx.field.get(t.target)
    this.unreachable.add(t.target)
    this.release(t)
    resetRoute(t)
    if (s) events.push({ type: 'gaveUp', trawler: t, spawn: s })
  }

  private goHome(t: Trawler, events: TrawlerEvent[]): void {
    this.release(t)
    this.setStatus(t, 'returning', events)
  }

  private completeDelivery(t: Trawler, ctx: TrawlerContext, events: TrawlerEvent[]): void {
    const counts = t.cargo
    const units = cargoUnits(counts)
    // Empty the hold first, pay second: the same cargo can never be paid twice.
    t.cargo = emptyCargo()
    const credits = units > 0 ? ctx.deliver(counts) : 0
    if (units > 0) {
      t.deliveries += 1
      events.push({ type: 'delivered', trawler: t, counts, units, credits })
    }
    t.idleTime = 0
    t.timer = BALANCE.trawler.departSeconds
    this.setStatus(t, 'departing', events)
  }

  /** Last resort: move to safe water. Cargo, claims-in-hand and credits are untouched. */
  private recover(t: Trawler, ctx: TrawlerContext, events: TrawlerEvent[], reason: 'stuck' | 'timeout' | 'no-path'): void {
    t.recoveries += 1
    const atStation = t.status === 'returning' || t.status === 'unloading' || t.status === 'departing'
    const spot = atStation ? this.bay : (this.nav.nearestFree(t.x, t.y) ?? this.bay)
    warp(t, spot)
    t.idleTime = 0
    events.push({ type: 'recovered', trawler: t, reason })
    void ctx
  }

  // ---- persistence -----------------------------------------------------------------------------------------------

  snapshot(): TrawlerSnapshot[] {
    return this.trawlers.map((t) => ({
      id: t.id,
      x: t.x,
      y: t.y,
      heading: t.heading,
      status: t.status,
      cargo: { ...t.cargo },
      deliveries: t.deliveries,
      collected: t.collected,
    }))
  }

  /**
   * Restore from a validated snapshot with interruption recovery: a trawler carrying cargo resumes the trip home, an
   * empty one launches again. Claims are never saved - they are rebuilt as trawlers choose targets.
   */
  restore(snaps: readonly TrawlerSnapshot[]): void {
    this.clear()
    for (const s of snaps.slice(0, BALANCE.trawler.maxTrawlers)) {
      const t = this.create(s.id, s.x, s.y, s.heading)
      this.nextId = Math.max(this.nextId, s.id + 1)
      t.cargo = { ...s.cargo }
      t.deliveries = s.deliveries
      t.collected = s.collected
      t.status = cargoUnits(t.cargo) > 0 ? 'returning' : 'departing'
      if (!this.nav.isFree(t.x, t.y)) {
        const free = this.nav.nearestFree(t.x, t.y) ?? this.bay
        t.x = free.x
        t.y = free.y
      }
      this.trawlers.push(t)
    }
  }
}
