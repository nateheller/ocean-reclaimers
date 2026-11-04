/**
 * Local arcade high scores (v0.3): top 10 per board, personal bests per name, duplicate protection.
 *
 * Stored under its own localStorage key, completely separate from expedition saves, so New Game (which clears the save)
 * never erases a high score. No accounts, no network.
 *
 * Scores are only ever compared inside one *board*, identified by region + mode (e.g. "coral-bay:standard"). Future
 * challenge modes or regions simply get their own board; every entry also records the balance version it was set under.
 */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { Completion } from './scoring'
import type { StorageLike } from './save'

export interface ScoreEntry {
  /** Run id of the expedition (the duplicate-submission key). */
  id: string
  name: string
  region: string
  mode: string
  finalScore: number
  baseScore: number
  timeSeconds: number
  multiplier: number
  bestChain: number
  seed: number
  balanceVersion: string
  /** ISO date-time. */
  date: string
}

export interface PersonalBest {
  name: string
  finalScore: number
  timeSeconds: number
  date: string
}

export interface ScoreStore {
  version: 1
  boards: Record<string, ScoreEntry[]>
  /** `${board}|${NAME}` -> best. Kept even if the entry later drops off the top 10. */
  personalBests: Record<string, PersonalBest>
  /** Run ids already recorded or evaluated; newest last, capped. */
  submitted: string[]
  lastName: string
}

export interface BoardRef {
  region: string
  mode: string
}

export const STANDARD_BOARD: BoardRef = { region: BALANCE.scoring.region, mode: BALANCE.scoring.mode }

export const boardKey = (b: BoardRef = STANDARD_BOARD): string => `${b.region}:${b.mode}`

const MAX_SUBMITTED = 200

export function emptyStore(): ScoreStore {
  return { version: 1, boards: {}, personalBests: {}, submitted: [], lastName: '' }
}

// ---- names ---------------------------------------------------------------------------------------------------------

/** Display form of a name: trimmed, single spaces, upper case, safe characters only, limited length. */
export function normalizeName(raw: string): string {
  const cleaned = String(raw ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('en-US')
    .slice(0, BALANCE.scoring.nameMaxLength)
    .trim()
  return cleaned.length > 0 ? cleaned : BALANCE.scoring.defaultName
}

/** Comparison key for personal bests: "Ann", " ann " and "ANN" are the same player. */
export const nameKey = (name: string): string => normalizeName(name)

// ---- storage ---------------------------------------------------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function readEntry(raw: unknown): ScoreEntry | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  if (!isNum(raw.finalScore) || raw.finalScore < 0 || !isNum(raw.timeSeconds) || raw.timeSeconds < 0) return null
  return {
    id: raw.id.slice(0, 64),
    name: normalizeName(raw.name),
    region: typeof raw.region === 'string' ? raw.region : STANDARD_BOARD.region,
    mode: typeof raw.mode === 'string' ? raw.mode : STANDARD_BOARD.mode,
    finalScore: Math.floor(raw.finalScore),
    baseScore: isNum(raw.baseScore) ? Math.floor(raw.baseScore) : Math.floor(raw.finalScore),
    timeSeconds: raw.timeSeconds,
    multiplier: isNum(raw.multiplier) && raw.multiplier >= 1 ? raw.multiplier : 1,
    bestChain: isNum(raw.bestChain) ? Math.max(0, Math.floor(raw.bestChain)) : 0,
    seed: isNum(raw.seed) ? raw.seed : WORLD.seed,
    balanceVersion: typeof raw.balanceVersion === 'string' ? raw.balanceVersion : 'unknown',
    date: typeof raw.date === 'string' ? raw.date : '',
  }
}

/** Order: higher score first; equal scores keep the older record on top, then the faster time. */
function compare(a: ScoreEntry, b: ScoreEntry): number {
  return b.finalScore - a.finalScore || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.timeSeconds - b.timeSeconds
}

export function parseScores(raw: string | null): ScoreStore {
  const store = emptyStore()
  if (!raw) return store
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return store
  }
  if (!isRecord(json) || json.version !== 1) return store
  if (isRecord(json.boards)) {
    for (const [key, list] of Object.entries(json.boards)) {
      if (!Array.isArray(list)) continue
      const seen = new Set<string>()
      const entries: ScoreEntry[] = []
      for (const item of list) {
        const e = readEntry(item)
        if (!e || seen.has(e.id)) continue
        seen.add(e.id)
        entries.push(e)
      }
      store.boards[key] = entries.sort(compare).slice(0, BALANCE.scoring.leaderboardSize)
    }
  }
  if (isRecord(json.personalBests)) {
    for (const [key, v] of Object.entries(json.personalBests)) {
      if (!isRecord(v) || !isNum(v.finalScore) || v.finalScore < 0) continue
      store.personalBests[key] = {
        name: typeof v.name === 'string' ? v.name : '',
        finalScore: Math.floor(v.finalScore),
        timeSeconds: isNum(v.timeSeconds) ? v.timeSeconds : 0,
        date: typeof v.date === 'string' ? v.date : '',
      }
    }
  }
  if (Array.isArray(json.submitted)) store.submitted = json.submitted.filter((v): v is string => typeof v === 'string').slice(-MAX_SUBMITTED)
  if (typeof json.lastName === 'string') store.lastName = normalizeName(json.lastName)
  return store
}

export function loadScores(storage: StorageLike): ScoreStore {
  try {
    return parseScores(storage.getItem(BALANCE.save.scoresKey))
  } catch {
    return emptyStore()
  }
}

function writeScores(storage: StorageLike, store: ScoreStore): boolean {
  try {
    storage.setItem(BALANCE.save.scoresKey, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

// ---- queries ------------------------------------------------------------------------------------------------------------

export function topScores(store: ScoreStore, board: BoardRef = STANDARD_BOARD): ScoreEntry[] {
  return [...(store.boards[boardKey(board)] ?? [])].sort(compare)
}

/** Where `score` would land (1-based) and whether that makes the table. A tie ranks below existing equal scores. */
export function rankFor(store: ScoreStore, score: number, board: BoardRef = STANDARD_BOARD): { rank: number; qualifies: boolean } {
  const list = topScores(store, board)
  const rank = list.filter((e) => e.finalScore >= score).length + 1
  return { rank, qualifies: rank <= BALANCE.scoring.leaderboardSize }
}

export function personalBest(store: ScoreStore, name: string, board: BoardRef = STANDARD_BOARD): PersonalBest | null {
  return store.personalBests[`${boardKey(board)}|${nameKey(name)}`] ?? null
}

export function alreadySubmitted(store: ScoreStore, runId: string): boolean {
  return store.submitted.includes(runId)
}

// ---- submitting ---------------------------------------------------------------------------------------------------------

export type SubmitResult =
  | {
      ok: true
      entry: ScoreEntry
      rank: number
      entries: ScoreEntry[]
      /** Previous best for this name (null on a first score) and whether the new score beat it. */
      previousBest: number | null
      newPersonalBest: boolean
      improvement: number
    }
  | { ok: false; reason: 'duplicate' | 'not-qualified' | 'storage' }

export interface SubmitInput {
  completion: Completion
  name: string
  board?: BoardRef
  now?: Date
  balanceVersion?: string
}

/**
 * Record a finished expedition. Each run id can be recorded once: a second attempt (double click, reload, replayed
 * save) is rejected with 'duplicate' and changes nothing.
 */
export function submitScore(storage: StorageLike, input: SubmitInput): SubmitResult {
  const board = input.board ?? STANDARD_BOARD
  const store = loadScores(storage)
  const c = input.completion
  if (alreadySubmitted(store, c.runId)) return { ok: false, reason: 'duplicate' }
  const { qualifies } = rankFor(store, c.finalScore, board)
  if (!qualifies) return { ok: false, reason: 'not-qualified' }

  const name = normalizeName(input.name)
  const entry: ScoreEntry = {
    id: c.runId,
    name,
    region: board.region,
    mode: board.mode,
    finalScore: c.finalScore,
    baseScore: c.baseScore,
    timeSeconds: c.timeSeconds,
    multiplier: c.multiplier,
    bestChain: c.bestChain,
    seed: WORLD.seed,
    balanceVersion: input.balanceVersion ?? BALANCE.scoring.balanceVersion,
    date: (input.now ?? new Date()).toISOString(),
  }
  const key = boardKey(board)
  const list = [...(store.boards[key] ?? []), entry].sort(compare)
  store.boards[key] = list.slice(0, BALANCE.scoring.leaderboardSize)
  const rank = list.indexOf(entry) + 1

  const pbKey = `${key}|${nameKey(name)}`
  const previous = store.personalBests[pbKey]
  const newPersonalBest = !!previous && c.finalScore > previous.finalScore
  if (!previous || c.finalScore > previous.finalScore) {
    store.personalBests[pbKey] = { name, finalScore: c.finalScore, timeSeconds: c.timeSeconds, date: entry.date }
  }
  store.submitted = [...store.submitted, c.runId].slice(-MAX_SUBMITTED)
  store.lastName = name
  if (!writeScores(storage, store)) return { ok: false, reason: 'storage' }
  return {
    ok: true,
    entry,
    rank,
    entries: store.boards[key],
    previousBest: previous ? previous.finalScore : null,
    newPersonalBest,
    improvement: newPersonalBest && previous ? c.finalScore - previous.finalScore : 0,
  }
}

/** Remember that a run was evaluated but did not make the table, so it is never offered or submitted again. */
export function markSubmitted(storage: StorageLike, runId: string): void {
  const store = loadScores(storage)
  if (alreadySubmitted(store, runId)) return
  store.submitted = [...store.submitted, runId].slice(-MAX_SUBMITTED)
  writeScores(storage, store)
}

export function rememberName(storage: StorageLike, name: string): void {
  const store = loadScores(storage)
  store.lastName = normalizeName(name)
  writeScores(storage, store)
}
