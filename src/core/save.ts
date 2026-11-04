/** Versioned localStorage persistence with strict validation. */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { BoatState } from './boat'
import { cargoUnits, emptyCargo, type CargoCounts } from './cargo'
import { emptyRunStats, type RunStats } from './events'
import type { GameModel, ModelSnapshot } from './model'
import { vesselStats } from './stats'
import type { TenderSnapshot, TenderStatus } from './tender'
import { noUpgrades, sanitizeLevels, UPGRADE_IDS, type UpgradeLevels } from './upgrades'
/** v1 = single-purchase upgrades (prototype). v2 = five-level upgrades + cargo tenders. */
export const SAVE_VERSION = 2
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
  if (!isRecord(json) || (json.version !== 1 && json.version !== 2) || json.seed !== WORLD.seed) return null
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
    upgrades = levels
  }
  void UPGRADE_IDS

  if (!Array.isArray(m.removed) || !Array.isArray(m.milestones)) return null
  const removed = m.removed.filter((v): v is number => Number.isInteger(v) && (!validIds || validIds.has(v as number)))
  const milestones = m.milestones.filter((v): v is number => isNum(v) && (BALANCE.progress.milestones as readonly number[]).includes(v))
  if (!isNum(b.x) || !isNum(b.y) || !isNum(b.heading)) return null
  // Reject a saved hold that cannot exist with the saved upgrades.
  if (cargoUnits(cargo) > vesselStats(upgrades).capacity) return null
  const tenders = json.version === 2 ? readTenders(m.tenders) : []
  if (!tenders) return null
  const stats = json.version === 2 ? readStats(m.stats) : emptyRunStats()
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
      playSeconds: nonNeg(m.playSeconds) ? Math.floor(m.playSeconds) : 0,
      completed: m.completed === true,
      tenders,
      stats,
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
