/**
 * Upgrade registry (v0.2, extended in v0.3 with Ocean Sonar and Auto Trawlers).
 *
 * Every upgrade is a *track* with a max level, a price per level, an effect description per level and an optional
 * requirement. The gameplay model only stores `levels` (a plain id -> level record), so:
 *  - run-based upgrades are just this record; a future "permanent research" layer can feed extra starting levels or
 *    extra tracks into the same registry without touching purchase logic,
 *  - a future "pick one of three random upgrades" system can offer `nextLevel(id)` choices from `UPGRADE_IDS`,
 *  - synergies can be written as pure functions of `UpgradeLevels` (see `stats.ts`) and the optional `tags`.
 */
import { BALANCE, type UpgradeId } from '../config/balance'

export type { UpgradeId }
export type UpgradeLevels = Record<UpgradeId, number>

/** Display / hotkey order. Keys 1-5 keep their v0.2 meaning; 6-8 are new. */
export const UPGRADE_IDS: readonly UpgradeId[] = ['cargo', 'engine', 'width', 'tender', 'fleet', 'sonar', 'trawler', 'trawlerFleet']

export interface UpgradeContext {
  readonly levels: Readonly<UpgradeLevels>
  /** Successful station visits so far this expedition. */
  readonly unloads: number
}

export interface UpgradeDef {
  readonly id: UpgradeId
  readonly name: string
  readonly category: 'vessel' | 'fleet' | 'explore'
  /** Free-form labels for future synergy / random-offer systems. */
  readonly tags: readonly string[]
  readonly maxLevel: number
  /** Price of reaching `level` (1..maxLevel). */
  cost(level: number): number
  /** Short description of the state at `level` (0 = nothing installed yet). */
  effect(level: number): string
  /** Returns a player-facing reason when the next level cannot be bought yet, otherwise null. */
  requirement?(ctx: UpgradeContext): string | null
}

function price(base: readonly number[], level: number): number {
  const raw = base[Math.min(Math.max(level, 1), base.length) - 1]
  return Math.max(1, Math.round(raw * BALANCE.upgrades.priceScale))
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  cargo: {
    id: 'cargo',
    name: BALANCE.upgrades.cargo.name,
    category: 'vessel',
    tags: ['vessel', 'capacity'],
    maxLevel: BALANCE.upgrades.cargo.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.cargo.baseCosts, l),
    effect: (l) => `${BALANCE.cargo.startCapacity + l * BALANCE.upgrades.cargo.perLevel} cargo units`,
  },
  engine: {
    id: 'engine',
    name: BALANCE.upgrades.engine.name,
    category: 'vessel',
    tags: ['vessel', 'speed'],
    maxLevel: BALANCE.upgrades.engine.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.engine.baseCosts, l),
    effect: (l) => `${l === 0 ? 'Base speed' : `+${pct(l * BALANCE.upgrades.engine.perLevel)} speed`}`,
  },
  width: {
    id: 'width',
    name: BALANCE.upgrades.width.name,
    category: 'vessel',
    tags: ['vessel', 'collection'],
    maxLevel: BALANCE.upgrades.width.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.width.baseCosts, l),
    effect: (l) => `${l === 0 ? 'Base width' : `+${pct(l * BALANCE.upgrades.width.perLevel)} width`}`,
  },
  tender: {
    id: 'tender',
    name: BALANCE.upgrades.tender.name,
    category: 'fleet',
    tags: ['fleet', 'tender', 'logistics'],
    maxLevel: BALANCE.upgrades.tender.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.tender.baseCosts, l),
    effect: (l) => {
      const t = BALANCE.upgrades.tender
      if (l <= 0) return 'No tender yet'
      const parts = [`carries ${t.capacity[l]}`]
      if (t.speedMult[l] > 1) parts.push(`+${pct(t.speedMult[l] - 1)} speed`)
      if (l >= t.autoDispatchLevel) parts.push('auto-dispatch')
      return parts.join(', ')
    },
    requirement: (ctx) => {
      if (ctx.levels.tender === 0 && ctx.unloads < BALANCE.upgrades.tender.minUnloadsToBuy) {
        const left = BALANCE.upgrades.tender.minUnloadsToBuy - ctx.unloads
        return `Visit the station ${left} more time${left === 1 ? '' : 's'}`
      }
      return null
    },
  },
  fleet: {
    id: 'fleet',
    name: BALANCE.upgrades.fleet.name,
    category: 'fleet',
    tags: ['fleet', 'tender'],
    maxLevel: BALANCE.upgrades.fleet.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.fleet.baseCosts, l),
    effect: (l) => (l <= 0 ? 'One tender' : 'Two tenders'),
    requirement: (ctx) =>
      ctx.levels.tender < BALANCE.upgrades.fleet.requiresTenderLevel
        ? `Needs Cargo Tender level ${BALANCE.upgrades.fleet.requiresTenderLevel}`
        : null,
  },
  sonar: {
    id: 'sonar',
    name: BALANCE.upgrades.sonar.name,
    category: 'explore',
    tags: ['explore', 'sonar'],
    maxLevel: BALANCE.upgrades.sonar.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.sonar.baseCosts, l),
    effect: (l) => {
      const S = BALANCE.upgrades.sonar
      const name = S.levelNames[Math.min(Math.max(l, 0), S.levelNames.length - 1)]
      if (l <= 0) return 'Debris located by sight'
      const detail = [
        '',
        'arrow to nearby concentrations',
        '3 arrows, longer range',
        'concentrations on the minimap',
        'whole bay revealed',
        'finds isolated debris',
      ][l]
      return `${name}: ${detail}`
    },
  },
  trawler: {
    id: 'trawler',
    name: BALANCE.upgrades.trawler.name,
    category: 'fleet',
    tags: ['fleet', 'trawler', 'autonomous'],
    maxLevel: BALANCE.upgrades.trawler.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.trawler.baseCosts, l),
    effect: (l) => {
      const T = BALANCE.upgrades.trawler
      if (l <= 0) return 'No trawler yet'
      const parts = [`holds ${T.capacity[l]}`]
      if (l === 3) parts.push('faster scooping')
      if (l === 4) parts.push('wider search, smarter routes')
      if (l === 5) parts.push('peak efficiency')
      return parts.join(', ')
    },
  },
  trawlerFleet: {
    id: 'trawlerFleet',
    name: BALANCE.upgrades.trawlerFleet.name,
    category: 'fleet',
    tags: ['fleet', 'trawler', 'autonomous'],
    maxLevel: BALANCE.upgrades.trawlerFleet.baseCosts.length,
    cost: (l) => price(BALANCE.upgrades.trawlerFleet.baseCosts, l),
    effect: (l) => (l <= 0 ? 'One trawler' : 'Two trawlers'),
    requirement: (ctx) =>
      ctx.levels.trawler < BALANCE.upgrades.trawlerFleet.requiresTrawlerLevel
        ? `Needs Auto Trawler level ${BALANCE.upgrades.trawlerFleet.requiresTrawlerLevel}`
        : null,
  },
}

export function noUpgrades(): UpgradeLevels {
  return { cargo: 0, engine: 0, width: 0, tender: 0, fleet: 0, sonar: 0, trawler: 0, trawlerFleet: 0 }
}

export function totalCost(id: UpgradeId): number {
  let sum = 0
  for (let l = 1; l <= UPGRADES[id].maxLevel; l++) sum += UPGRADES[id].cost(l)
  return sum
}

export type PurchaseCheck =
  | { ok: true; id: UpgradeId; level: number; cost: number }
  | { ok: false; reason: 'max' | 'poor' | 'locked'; message: string; cost: number }

/** Can the next level of `id` be bought with `credits`? Pure; used by the model, the UI and tests. */
export function checkPurchase(id: UpgradeId, ctx: UpgradeContext, credits: number): PurchaseCheck {
  const def = UPGRADES[id]
  const level = ctx.levels[id]
  if (level >= def.maxLevel) return { ok: false, reason: 'max', message: 'Maximum level', cost: 0 }
  const next = level + 1
  const cost = def.cost(next)
  const locked = def.requirement?.(ctx)
  if (locked) return { ok: false, reason: 'locked', message: locked, cost }
  if (credits < cost) return { ok: false, reason: 'poor', message: `${cost - credits} more credits`, cost }
  return { ok: true, id, level: next, cost }
}

/** Clamp an arbitrary record (e.g. from a save) into valid levels. */
export function sanitizeLevels(raw: Record<string, unknown>): UpgradeLevels | null {
  const out = noUpgrades()
  for (const id of UPGRADE_IDS) {
    const v = raw[id]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > UPGRADES[id].maxLevel) return null
    out[id] = v
  }
  return out
}
