/**
 * Completion-time scoring (v0.3).
 *
 *   Final Score = Base Arcade Score x Time Multiplier
 *
 * The base score is the existing collection + combo score. The time multiplier rewards finishing Coral Bay (75%
 * cleaned) quickly, using *active* play time only (pauses are excluded by the caller). The bands are configurable in
 * `BALANCE.scoring` and are provisional: they are not a statistically established benchmark.
 */
import { BALANCE } from '../config/balance'

/** Seconds are rounded to hundredths so a saved game and a live game always agree. */
export function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100
}

/**
 * Time multiplier for a completion time in seconds. The first band whose upper bound is strictly greater than the time
 * applies, so exactly 4:00 is in the 4-5 minute band and exactly 8:00 is "over 8 minutes". Never below 1.
 */
export function timeMultiplier(seconds: number): number {
  const t = roundTime(seconds)
  for (const band of BALANCE.scoring.timeBands) if (t < band.below) return Math.max(1, band.multiplier)
  return Math.max(1, BALANCE.scoring.slowMultiplier)
}

/** Final score, rounded to a whole number the same way everywhere. Never negative. */
export function finalScore(baseScore: number, multiplier: number): number {
  return Math.max(0, Math.round(Math.max(0, baseScore) * Math.max(1, multiplier)))
}

/** m:ss for display ("5:07"). */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(roundTime(seconds)))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** The band a time falls into, as a short label ("Under 4:00", "4:00-5:00", "Over 8:00"). */
export function timeBandLabel(seconds: number): string {
  const t = roundTime(seconds)
  const bands = BALANCE.scoring.timeBands
  let prev = 0
  for (const band of bands) {
    if (t < band.below) return prev === 0 ? `Under ${formatTime(band.below)}` : `${formatTime(prev)}-${formatTime(band.below)}`
    prev = band.below
  }
  return `Over ${formatTime(prev)}`
}

/** A finished expedition: captured exactly once, when 75% is first reached. */
export interface Completion {
  /** Random id of the expedition; the key that prevents duplicate leaderboard submissions. */
  runId: string
  /** Active play time when the goal was first reached (seconds, hundredths). */
  timeSeconds: number
  baseScore: number
  multiplier: number
  finalScore: number
  bestChain: number
  /** pending = not yet recorded; saved = recorded; skipped = did not qualify; legacy = finished before v0.3. */
  entry: 'pending' | 'saved' | 'skipped' | 'legacy'
}

export function makeCompletion(runId: string, timeSeconds: number, baseScore: number, bestChain: number): Completion {
  const t = roundTime(timeSeconds)
  const multiplier = timeMultiplier(t)
  return {
    runId,
    timeSeconds: t,
    baseScore,
    multiplier,
    finalScore: finalScore(baseScore, multiplier),
    bestChain,
    entry: 'pending',
  }
}

/** A fresh, practically unique id for one expedition. */
export function makeRunId(): string {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(36)
  return `${Date.now().toString(36)}-${rand}`
}
