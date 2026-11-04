/** Versioned localStorage persistence with strict validation. */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { BoatState } from './boat'
import { emptyCargo } from './cargo'
import type { GameModel, ModelSnapshot } from './model'
import { noUpgrades, UPGRADE_IDS } from './stats'

export const SAVE_VERSION = 1

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

/** Parse and validate raw JSON. Returns null for anything untrustworthy. */
export function parseSave(raw: string | null, validIds?: ReadonlySet<number>): SaveData | null {
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(json) || json.version !== SAVE_VERSION || json.seed !== WORLD.seed) return null
  const m = json.model
  const b = json.boat
  if (!isRecord(m) || !isRecord(b)) return null
  if (!nonNeg(m.credits) || !nonNeg(m.score)) return null
  if (!isRecord(m.cargo) || !isRecord(m.upgrades)) return null

  const cargo = emptyCargo()
  for (const key of ['bottle', 'container', 'net'] as const) {
    const v = m.cargo[key]
    if (!nonNeg(v) || !Number.isInteger(v)) return null
    cargo[key] = v
  }
  const upgrades = noUpgrades()
  for (const id of UPGRADE_IDS) {
    if (typeof m.upgrades[id] !== 'boolean') return null
    upgrades[id] = m.upgrades[id] as boolean
  }
  if (!Array.isArray(m.removed) || !Array.isArray(m.milestones)) return null
  const removed = m.removed.filter((v): v is number => Number.isInteger(v) && (!validIds || validIds.has(v as number)))
  const milestones = m.milestones.filter((v): v is number => isNum(v) && (BALANCE.progress.milestones as readonly number[]).includes(v))
  if (!isNum(b.x) || !isNum(b.y) || !isNum(b.heading)) return null

  // Reject a saved hold that cannot exist with the saved upgrades.
  const capacity = BALANCE.cargo.startCapacity + (upgrades.cargo ? BALANCE.upgrades.cargo.value : 0)
  const used = cargo.bottle * BALANCE.debris.bottle.cargo + cargo.container * BALANCE.debris.container.cargo + cargo.net * BALANCE.debris.net.cargo
  if (used > capacity) return null

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
      unloads: nonNeg(m.unloads) ? Math.floor(m.unloads) : 0,
      bestChain: nonNeg(m.bestChain) ? Math.floor(m.bestChain) : 0,
      playSeconds: nonNeg(m.playSeconds) ? Math.floor(m.playSeconds) : 0,
      completed: m.completed === true,
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
