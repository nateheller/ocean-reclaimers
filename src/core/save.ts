/** Versioned localStorage persistence with strict validation. */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { BoatState } from './boat'
import { cargoUnits, emptyCargo, type CargoCounts } from './cargo'
import { emptyRunStats, type RunStats } from './events'
import type { GameModel, ModelSnapshot } from './model'
import { makeRunId, roundTime, type Completion } from './scoring'
import { vesselStats } from './stats'
import type { TenderSnapshot, TenderStatus } from './tender'
import type { TrawlerSnapshot, TrawlerStatus } from './trawler'
import { noUpgrades, sanitizeLevels, UPGRADE_IDS, type UpgradeLevels } from './upgrades'
/** v1 = single-purchase upgrades (prototype). v2 = five-level upgrades + cargo tenders. v3 = sonar, trawlers, scoring. */
export const SAVE_VERSION = 3
const TRAWLER_STATUSES: readonly TrawlerStatus[] = ['searching', 'collecting', 'returning', 'unloading', 'departing']
const TENDER_STATUSES: readonly TenderStatus[] = ['idle', 'toPlayer', 'loading', 'delivering', 'unloading', 'returning']

export interface SaveData {
  version: number
  seed: number
  savedAt: number
  model: ModelSnapshot
  boat: { x: number; y: number; heading: number }
}

export interface Settings {
  muted: boolean
}

/** Minimal Storage surface so tests can inject an in-memory store. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const nonNeg = (v: unknown): v is number => isNum(v) && v >= 0
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function buildSave(model: GameModel, boat: Pick<BoatState, 'x' | 'y' | 'heading'>, now = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    seed: WORLD.seed,
    savedAt: now,
    model: model.snapshot(),
    boat: { x: boat.x, y: boat.y, heading: boat.heading },
  }
}

/** v0.1 flags -> the v0.2 level with the same effect (+10 cargo = L2, +15% engine = L3, +25% width = L3). */
const V1_LEVELS = { cargo: 2, engine: 3, width: 3 } as const

function readCargo(raw: unknown): CargoCounts | null {
  if (!isRecord(raw)) return null
  const cargo = emptyCargo()
  for (const key of ['bottle', 'container', 'net'] as const) {
    const v = raw[key]
    if (!nonNeg(v) || !Number.isInteger(v)) return null
    cargo[key] = v
  }
  return cargo
}

function readTenders(raw: unknown): TenderSnapshot[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > BALANCE.tender.maxTenders) return null
  const maxUnits = Math.max(...BALANCE.upgrades.tender.capacity)
  const out: TenderSnapshot[] = []
  const ids = new Set<number>()
  for (const t of raw) {
    if (!isRecord(t)) return null
    const cargo = readCargo(t.cargo)
    if (!cargo || cargoUnits(cargo) > maxUnits) return null
    if (!Number.isInteger(t.id) || ids.has(t.id as number)) return null
    if (!isNum(t.x) || !isNum(t.y) || !isNum(t.heading)) return null
    if (!TENDER_STATUSES.includes(t.status as TenderStatus)) return null
    if (!nonNeg(t.deliveries)) return null
    ids.add(t.id as number)
    out.push({
      id: t.id as number,
      x: Math.min(Math.max(t.x, 0), WORLD.width),
      y: Math.min(Math.max(t.y, 0), WORLD.height),
      heading: t.heading,
      status: t.status as TenderStatus,
      cargo,
      deliveries: Math.floor(t.deliveries),
    })
  }
  return out
}

function readTrawlers(raw: unknown): TrawlerSnapshot[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > BALANCE.trawler.maxTrawlers) return null
  const maxUnits = Math.max(...BALANCE.upgrades.trawler.capacity)
  const out: TrawlerSnapshot[] = []
  const ids = new Set<number>()
  for (const t of raw) {
    if (!isRecord(t)) return null
    const cargo = readCargo(t.cargo)
    if (!cargo || cargoUnits(cargo) > maxUnits) return null
    if (!Number.isInteger(t.id) || ids.has(t.id as number)) return null
    if (!isNum(t.x) || !isNum(t.y) || !isNum(t.heading)) return null
    if (!TRAWLER_STATUSES.includes(t.status as TrawlerStatus)) return null
    ids.add(t.id as number)
    out.push({
      id: t.id as number,
      x: Math.min(Math.max(t.x, 0), WORLD.width),
      y: Math.min(Math.max(t.y, 0), WORLD.height),
      heading: t.heading,
      status: t.status as TrawlerStatus,
      cargo,
      deliveries: nonNeg(t.deliveries) ? Math.floor(t.deliveries) : 0,
      collected: nonNeg(t.collected) ? Math.floor(t.collected) : 0,
    })
  }
  return out
}

const ENTRY_STATES: readonly Completion['entry'][] = ['pending', 'saved', 'skipped', 'legacy']

/** A saved completion record, or null if it is missing or untrustworthy (the run is then simply not scored). */
function readCompletion(raw: unknown): Completion | null {
  if (!isRecord(raw)) return null
  if (typeof raw.runId !== 'string' || raw.runId.length === 0 || raw.runId.length > 64) return null
  if (!nonNeg(raw.timeSeconds) || !nonNeg(raw.baseScore) || !nonNeg(raw.finalScore)) return null
  if (!isNum(raw.multiplier) || raw.multiplier < 1) return null
  if (!ENTRY_STATES.includes(raw.entry as Completion['entry'])) return null
  return {
    runId: raw.runId,
    timeSeconds: roundTime(raw.timeSeconds),
    baseScore: Math.floor(raw.baseScore),
    multiplier: raw.multiplier,
    finalScore: Math.floor(raw.finalScore),
    bestChain: nonNeg(raw.bestChain) ? Math.floor(raw.bestChain) : 0,
    entry: raw.entry as Completion['entry'],
    ...(raw.goal === 1 ? { goal: 1 as const } : {}),
  }
}

function readStats(raw: unknown): RunStats {
  const stats = emptyRunStats()
  if (!isRecord(raw)) return stats
  const num = (v: unknown) => (nonNeg(v) ? Math.floor(v) : 0)
  if (isRecord(raw.collected)) {
    for (const k of ['bottle', 'container', 'net'] as const) stats.collected[k] = num(raw.collected[k])
  }
  for (const k of [
    'bestChain', 'unloads', 'creditsEarned', 'creditsSpent', 'upgradesBought',
    'tenderDispatches', 'tenderDeliveries', 'tenderUnits', 'tenderCredits', 'trawlerDeployments',
    'trawlerCollected', 'trawlerDeliveries', 'trawlerUnits', 'trawlerCredits',
  ] as const) stats[k] = num(raw[k])
  return stats
}

/** Parse and validate raw JSON. Returns null for anything untrustworthy. Version 1 saves are migrated. */
export function parseSave(raw: string | null, validIds?: ReadonlySet<number>): SaveData | null {
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(json) || (json.version !== 1 && json.version !== 2 && json.version !== 3) || json.seed !== WORLD.seed) return null
  const m = json.model
  const b = json.boat
  if (!isRecord(m) || !isRecord(b)) return null
  if (!nonNeg(m.credits) || !nonNeg(m.score)) return null
  if (!isRecord(m.upgrades)) return null
  const cargo = readCargo(m.cargo)
  if (!cargo) return null

  let upgrades: UpgradeLevels
  if (json.version === 1) {
    upgrades = noUpgrades()
    for (const id of ['cargo', 'engine', 'width'] as const) {
      if (typeof m.upgrades[id] !== 'boolean') return null
      if (m.upgrades[id]) upgrades[id] = V1_LEVELS[id]
    }
  } else {
    const levels = sanitizeLevels(m.upgrades)
    if (!levels) return null
    if (levels.fleet > 0 && levels.tender < BALANCE.upgrades.fleet.requiresTenderLevel) return null
    if (levels.trawlerFleet > 0 && levels.trawler < BALANCE.upgrades.trawlerFleet.requiresTrawlerLevel) return null
    upgrades = levels
  }
  void UPGRADE_IDS

  if (!Array.isArray(m.removed) || !Array.isArray(m.milestones)) return null
  const removed = m.removed.filter((v): v is number => Number.isInteger(v) && (!validIds || validIds.has(v as number)))
  const milestones = m.milestones.filter((v): v is number => isNum(v) && (BALANCE.progress.milestones as readonly number[]).includes(v))
  if (!isNum(b.x) || !isNum(b.y) || !isNum(b.heading)) return null
  // Reject a saved hold that cannot exist with the saved upgrades.
  if (cargoUnits(cargo) > vesselStats(upgrades).capacity) return null
  const tenders = json.version >= 2 ? readTenders(m.tenders) : []
  if (!tenders) return null
  const trawlers = json.version >= 3 ? readTrawlers(m.trawlers) : []
  if (!trawlers) return null
  const stats = json.version >= 2 ? readStats(m.stats) : emptyRunStats()
  // Older saves have no run id: the migrated run gets a fresh one. A finished older run has no completion record
  // (its play time was not captured at the moment of completion), so it is never offered to the leaderboard.
  const runId = typeof m.runId === 'string' && m.runId.length > 0 && m.runId.length <= 64 ? m.runId : makeRunId()
  const completion = json.version >= 3 ? readCompletion(m.completion) : null
  const unloads = nonNeg(m.unloads) ? Math.floor(m.unloads) : 0
  return {
    version: SAVE_VERSION,
    seed: json.seed as number,
    savedAt: isNum(json.savedAt) ? json.savedAt : 0,
    model: {
      credits: Math.floor(m.credits),
      score: Math.floor(m.score),
      cargo,
      upgrades,
      removed,
      milestones,
      unloads,
      bestChain: nonNeg(m.bestChain) ? Math.floor(m.bestChain) : 0,
      playSeconds: nonNeg(m.playSeconds) ? roundTime(m.playSeconds) : 0,
      completed: m.completed === true,
      tenders,
      trawlers,
      stats,
      runId,
      completion,
    },
    boat: {
      x: Math.min(Math.max(b.x, 0), WORLD.width),
      y: Math.min(Math.max(b.y, 0), WORLD.height),
      heading: b.heading,
    },
  }
}

export function loadSave(storage: StorageLike, validIds?: ReadonlySet<number>): SaveData | null {
  try {
    return parseSave(storage.getItem(BALANCE.save.key), validIds)
  } catch {
    return null
  }
}

export function writeSave(storage: StorageLike, data: SaveData): boolean {
  try {
    storage.setItem(BALANCE.save.key, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function clearSave(storage: StorageLike): void {
  try {
    storage.removeItem(BALANCE.save.key)
  } catch {
    /* ignore */
  }
}

export function loadSettings(storage: StorageLike): Settings {
  try {
    const raw = storage.getItem(BALANCE.save.settingsKey)
    if (raw) {
      const json = JSON.parse(raw)
      if (isRecord(json)) return { muted: json.muted === true }
    }
  } catch {
    /* fall through */
  }
  return { muted: false }
}

export function writeSettings(storage: StorageLike, settings: Settings): void {
  try {
    storage.setItem(BALANCE.save.settingsKey, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}
