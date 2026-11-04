/** Pure gameplay state: cargo, credits, upgrades, combo, cleanup progress. No rendering. */
import { BALANCE, type DebrisType, type UpgradeId } from '../config/balance'
import { cargoCredits, cargoUnits, canFit, emptyCargo, type CargoCounts } from './cargo'
import { ComboTracker, multiplierForChain } from './combo'
import { applyEvent, emptyRunStats, type GameEvent, type RunStats } from './events'
import type { NavGrid } from './nav'
import { worldNav, worldObstacles } from './navmap'
import { noUpgrades, tenderStats, vesselStats, type TenderStats, type VesselStats } from './stats'
import {
  TenderFleet,
  splitCargo,
  type RequestResult,
  type TenderEvent,
  type TenderSnapshot,
} from './tender'
import { checkPurchase, UPGRADE_IDS, UPGRADES, type PurchaseCheck, type UpgradeLevels } from './upgrades'
import { generateDebris, type Circle, type DebrisSpawn } from './worldgen'

export type CollectResult =
  | {
      ok: true
      spawn: DebrisSpawn
      chain: number
      multiplier: number
      scoreGained: number
      cargoUsed: number
      progress: number
      newMilestones: number[]
    }
  | { ok: false; reason: 'full' | 'gone' }

export interface UnloadResult {
  credits: number
  units: number
  items: number
  counts: CargoCounts
}

export type BuyResult = PurchaseCheck

/** The slice of the player's boat the tender fleet needs to know about. */
export interface PlayerRef {
  x: number
  y: number
  vx: number
  vy: number
  heading: number
}

export interface ModelSnapshot {
  credits: number
  score: number
  cargo: CargoCounts
  upgrades: UpgradeLevels
  removed: number[]
  milestones: number[]
  unloads: number
  bestChain: number
  playSeconds: number
  completed: boolean
  tenders: TenderSnapshot[]
  stats: RunStats
}

export class GameModel {
  readonly spawns: readonly DebrisSpawn[]
  readonly totalUnits: number

  credits = 0
  score = 0
  cargo: CargoCounts = emptyCargo()
  upgrades: UpgradeLevels = noUpgrades()
  readonly runStats: RunStats = emptyRunStats()
  readonly fleet: TenderFleet
  readonly removed = new Set<number>()
  readonly milestones = new Set<number>()
  readonly combo = new ComboTracker()
  playSeconds = 0
  /** Set once the primary 75% goal has been reached. */
  completed = false

  private removedUnits = 0
  private readonly spawnById = new Map<number, DebrisSpawn>()
  private readonly listeners = new Set<(e: GameEvent) => void>()
  private readonly obstacles: readonly Circle[]

  constructor(
    spawns: readonly DebrisSpawn[] = generateDebris(),
    nav: () => NavGrid = worldNav,
    obstacles: readonly Circle[] = worldObstacles(),
  ) {
    this.obstacles = obstacles
    this.fleet = new TenderFleet(nav)
    this.spawns = spawns
    spawns.forEach((s) => this.spawnById.set(s.id, s))
    this.totalUnits = spawns.reduce((sum, s) => sum + BALANCE.debris[s.type].cargo, 0)
  }

  // ---- derived values -----------------------------------------------------

  get stats(): VesselStats {
    return vesselStats(this.upgrades)
  }
  get tenderStats(): TenderStats {
    return tenderStats(this.upgrades)
  }
  get unloads(): number {
    return this.runStats.unloads
  }
  /** Subscribe to gameplay events (achievements, analytics, UI). Returns an unsubscribe function. */
  listen(fn: (e: GameEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(e: GameEvent): void {
    applyEvent(this.runStats, e)
    for (const fn of this.listeners) fn(e)
  }

  get capacity(): number {
    return this.stats.capacity
  }

  get cargoUsed(): number {
    return cargoUnits(this.cargo)
  }

  get cargoFree(): number {
    return this.capacity - this.cargoUsed
  }

  /** Fraction (0..1) of the starting debris that has been removed from the water. */
  get progress(): number {
    return this.totalUnits === 0 ? 0 : this.removedUnits / this.totalUnits
  }

  get remainingCount(): number {
    return this.spawns.length - this.removed.size
  }

  isRemoved(id: number): boolean {
    return this.removed.has(id)
  }

  canCollect(type: DebrisType): boolean {
    return canFit(this.cargo, this.capacity, type)
  }

  // ---- actions --------------------------------------------------------------

  /** Attempt to take a piece of debris into the hold. `now` is game time in seconds. */
  collect(id: number, now: number): CollectResult {
    const spawn = this.spawnById.get(id)
    if (!spawn || this.removed.has(id)) return { ok: false, reason: 'gone' }
    if (!this.canCollect(spawn.type)) return { ok: false, reason: 'full' }

    const spec = BALANCE.debris[spawn.type]
    this.removed.add(id)
    this.cargo[spawn.type] += 1
    this.removedUnits += spec.cargo

    const before = this.combo.chain
    const { chain, multiplier } = this.combo.register(now)
    // The combo multiplies arcade score only. Cargo and credits are never touched by it.
    const scoreGained = Math.round(spec.score * multiplier)
    this.score += scoreGained
    this.emit({ type: 'collected', debris: spawn.type, chain, multiplier, scoreGained })
    if (multiplier > multiplierForChain(before)) this.emit({ type: 'comboReached', chain, multiplier })
    const newMilestones = this.claimMilestones()

    return {
      ok: true,
      spawn,
      chain,
      multiplier,
      scoreGained,
      cargoUsed: this.cargoUsed,
      progress: this.progress,
      newMilestones,
    }
  }

  /** Empty the hold at the station and pay out credits. */
  unload(): UnloadResult {
    const counts = { ...this.cargo }
    const credits = cargoCredits(counts)
    const units = cargoUnits(counts)
    const items = counts.bottle + counts.container + counts.net
    this.credits += credits
    this.cargo = emptyCargo()
    this.emit({ type: 'unloaded', items, units, credits })
    return { credits, units, items, counts }
  }

  canBuy(id: UpgradeId): BuyResult {
    return checkPurchase(id, { levels: this.upgrades, unloads: this.unloads }, this.credits)
  }

  /** Buy the next level of an upgrade track. Fails (with no side effects) at max level, when locked or when poor. */
  buy(id: UpgradeId): BuyResult {
    const check = this.canBuy(id)
    if (!check.ok) return check
    this.credits -= check.cost
    this.upgrades = { ...this.upgrades, [id]: check.level }
    this.emit({ type: 'purchased', id, level: check.level, cost: check.cost })
    this.fleet.sync(this.tenderStats.count)
    return check
  }

  // ---- cargo tenders ---------------------------------------------------------------------------------------------
  /** Remove whole items (at most `maxUnits` cargo units) from the player's hold. Conserves cargo exactly. */
  takeCargo(maxUnits: number): CargoCounts {
    const { taken, remaining } = splitCargo(this.cargo, maxUnits)
    this.cargo = remaining
    return taken
  }

  /** Station-side payout for cargo delivered by a tender. */
  receiveDelivery(counts: CargoCounts): number {
    const credits = cargoCredits(counts)
    this.credits += credits
    return credits
  }

  private fleetContext(player: PlayerRef) {
    return {
      player,
      stats: this.tenderStats,
      obstacles: this.obstacles,
      takeFromHold: (max: number) => this.takeCargo(max),
      deliver: (counts: CargoCounts) => this.receiveDelivery(counts),
      holdFill: () => (this.capacity > 0 ? this.cargoUsed / this.capacity : 0),
      holdUnits: () => this.cargoUsed,
    }
  }

  /** Player pressed R. */
  requestTender(player: PlayerRef): { result: RequestResult; events: TenderEvent[] } {
    const r = this.fleet.request(this.fleetContext(player))
    const events: TenderEvent[] = r.ok && r.events ? [...r.events] : []
    if (r.ok) events.push({ type: 'status', tender: r.tender, from: 'idle', to: 'toPlayer' })
    this.ingest(events)
    const { events: _drop, ...result } = r
    void _drop
    return { result: result as RequestResult, events }
  }

  /** Advance every tender by `dt` seconds. */
  updateFleet(dt: number, player: PlayerRef): TenderEvent[] {
    const events = this.fleet.update(dt, this.fleetContext(player))
    this.ingest(events)
    return events
  }

  private ingest(events: readonly TenderEvent[]): void {
    for (const e of events) {
      if (e.type === 'dispatched') this.emit({ type: 'tenderDispatched', tenderId: e.tender.id, auto: e.auto })
      else if (e.type === 'loaded') this.emit({ type: 'tenderLoaded', tenderId: e.tender.id, units: e.units })
      else if (e.type === 'delivered') {
        this.emit({ type: 'tenderDelivered', tenderId: e.tender.id, units: e.units, credits: e.credits, counts: e.counts })
      }
    }
  }

  /** Advance time-based state (combo expiry, play clock). */
  tick(now: number, dt: number): { comboExpired: boolean } {
    this.playSeconds += dt
    return { comboExpired: this.combo.expire(now) }
  }

  private claimMilestones(): number[] {
    const fresh: number[] = []
    for (const m of BALANCE.progress.milestones) {
      if (this.progress + 1e-9 >= m && !this.milestones.has(m)) {
        this.milestones.add(m)
        fresh.push(m)
        this.emit({ type: 'milestone', milestone: m })
      }
    }
    if (this.progress + 1e-9 >= BALANCE.progress.completion && !this.completed) {
      this.completed = true
      this.emit({ type: 'completed' })
    }
    return fresh
  }

  // ---- persistence ----------------------------------------------------------

  snapshot(): ModelSnapshot {
    return {
      credits: this.credits,
      score: this.score,
      cargo: { ...this.cargo },
      upgrades: { ...this.upgrades },
      removed: [...this.removed].sort((a, b) => a - b),
      milestones: [...this.milestones].sort((a, b) => a - b),
      unloads: this.unloads,
      bestChain: this.combo.best,
      playSeconds: Math.round(this.playSeconds),
      completed: this.completed,
      tenders: this.fleet.snapshot(),
      stats: JSON.parse(JSON.stringify(this.runStats)) as RunStats,
    }
  }

  /** Restore from an already validated snapshot. */
  restore(snap: ModelSnapshot): void {
    this.credits = snap.credits
    this.score = snap.score
    this.cargo = { ...snap.cargo }
    this.upgrades = { ...snap.upgrades }
    this.removed.clear()
    this.removedUnits = 0
    for (const id of snap.removed) {
      const spawn = this.spawnById.get(id)
      if (!spawn) continue
      this.removed.add(id)
      this.removedUnits += BALANCE.debris[spawn.type].cargo
    }
    this.milestones.clear()
    for (const m of snap.milestones) this.milestones.add(m)
    Object.assign(this.runStats, emptyRunStats(), JSON.parse(JSON.stringify(snap.stats)) as RunStats)
    this.runStats.unloads = snap.unloads
    this.runStats.bestChain = Math.max(this.runStats.bestChain, snap.bestChain)
    this.combo.reset()
    this.combo.best = snap.bestChain
    this.playSeconds = snap.playSeconds
    this.completed = snap.completed
    this.fleet.restore(snap.tenders)
    // Owned upgrades always imply their tenders, even if a save predates a tender being launched.
    this.fleet.sync(this.tenderStats.count)
  }
  allUpgradesOwned(): boolean {
    return UPGRADE_IDS.every((id) => this.upgrades[id] >= UPGRADES[id].maxLevel)
  }
}
