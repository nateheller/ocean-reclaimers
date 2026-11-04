/** Pure gameplay state: cargo, credits, upgrades, combo, cleanup progress. No rendering. */
import { BALANCE, type DebrisType, type UpgradeId } from '../config/balance'
import { cargoCredits, cargoUnits, canFit, emptyCargo, type CargoCounts } from './cargo'
import { ComboTracker } from './combo'
import { noUpgrades, vesselStats, UPGRADE_IDS, type UpgradeFlags, type VesselStats } from './stats'
import { generateDebris, type DebrisSpawn } from './worldgen'

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

export type BuyResult = { ok: true; id: UpgradeId; cost: number } | { ok: false; reason: 'owned' | 'poor' }

export interface ModelSnapshot {
  credits: number
  score: number
  cargo: CargoCounts
  upgrades: UpgradeFlags
  removed: number[]
  milestones: number[]
  unloads: number
  bestChain: number
  playSeconds: number
  completed: boolean
}

export class GameModel {
  readonly spawns: readonly DebrisSpawn[]
  readonly totalUnits: number

  credits = 0
  score = 0
  cargo: CargoCounts = emptyCargo()
  upgrades: UpgradeFlags = noUpgrades()
  readonly removed = new Set<number>()
  readonly milestones = new Set<number>()
  readonly combo = new ComboTracker()
  unloads = 0
  playSeconds = 0
  /** Set once the primary 75% goal has been reached. */
  completed = false

  private removedUnits = 0
  private readonly spawnById = new Map<number, DebrisSpawn>()

  constructor(spawns: readonly DebrisSpawn[] = generateDebris()) {
    this.spawns = spawns
    spawns.forEach((s) => this.spawnById.set(s.id, s))
    this.totalUnits = spawns.reduce((sum, s) => sum + BALANCE.debris[s.type].cargo, 0)
  }

  // ---- derived values -----------------------------------------------------

  get stats(): VesselStats {
    return vesselStats(this.upgrades)
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

    const { chain, multiplier } = this.combo.register(now)
    // The combo multiplies arcade score only. Cargo and credits are never touched by it.
    const scoreGained = Math.round(spec.score * multiplier)
    this.score += scoreGained

    return {
      ok: true,
      spawn,
      chain,
      multiplier,
      scoreGained,
      cargoUsed: this.cargoUsed,
      progress: this.progress,
      newMilestones: this.claimMilestones(),
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
    if (items > 0) this.unloads += 1
    return { credits, units, items, counts }
  }

  canBuy(id: UpgradeId): BuyResult {
    if (this.upgrades[id]) return { ok: false, reason: 'owned' }
    const cost = BALANCE.upgrades[id].cost
    if (this.credits < cost) return { ok: false, reason: 'poor' }
    return { ok: true, id, cost }
  }

  buy(id: UpgradeId): BuyResult {
    const check = this.canBuy(id)
    if (!check.ok) return check
    this.credits -= check.cost
    this.upgrades = { ...this.upgrades, [id]: true }
    return check
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
      }
    }
    if (this.progress + 1e-9 >= BALANCE.progress.completion) this.completed = true
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
    this.unloads = snap.unloads
    this.combo.reset()
    this.combo.best = snap.bestChain
    this.playSeconds = snap.playSeconds
    this.completed = snap.completed
  }

  allUpgradesOwned(): boolean {
    return UPGRADE_IDS.every((id) => this.upgrades[id])
  }
}
