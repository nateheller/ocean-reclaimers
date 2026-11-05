import { describe, expect, it } from 'vitest'
import { BALANCE } from '../src/config/balance'
import { boostCooldownFraction, boostReady, createBoat, stepBoat } from '../src/core/boat'
import { GameModel } from '../src/core/model'
import { buildSave, loadSave, MemoryStorage, parseSave, writeSave } from '../src/core/save'
import { noUpgrades, vesselStats } from '../src/core/stats'
import { UPGRADES } from '../src/core/upgrades'
import { completionBoard, HISTORICAL_BOARD, PRE_BOOST_BOARD, STANDARD_BOARD, loadScores, submitScore, topScores } from '../src/core/leaderboard'
import { makeCompletion } from '../src/core/scoring'

const idle = { throttle: 0, steer: 0, boost: false }
const levels = [0, 1, 2, 3]

describe('timed boost upgrades', () => {
  it.each(levels.flatMap((reserve) => levels.map((recovery) => [reserve, recovery])))('runs Reserve %i / Recovery %i with continuous HUD progress', (reserve, recovery) => {
    const stats = vesselStats({ ...noUpgrades(), boostReserve: reserve, boostRecovery: recovery })
    const duration = [1.5, 2, 2.5, 3][reserve]
    const cooldown = [4.5, 3.75, 3, 2.5][recovery]
    expect(stats.boostDuration).toBe(duration)
    expect(stats.boostCooldown).toBe(cooldown)
    const b = createBoat()
    expect(boostReady(b)).toBe(true)
    expect(boostCooldownFraction(b)).toBe(0)
    expect(stepBoat(b, { ...idle, boost: true }, stats, 0).boostStarted).toBe(true)
    expect(boostCooldownFraction(b)).toBe(1)
    let fraction = 1
    for (let elapsed = 0; elapsed < duration; elapsed += 0.125) {
      // Repeated requests cannot extend or restart the burst.
      const event = stepBoat(b, { ...idle, boost: true }, stats, 0.125)
      expect(event.boostStarted).toBe(false)
      const next = boostCooldownFraction(b)
      expect(next).toBeLessThan(fraction)
      fraction = next
    }
    expect(b.boostLeft).toBe(0)
    expect(b.boostCooldown).toBe(cooldown)
    expect(fraction).toBeCloseTo(cooldown / (duration + cooldown))
    for (let elapsed = 0; elapsed < cooldown; elapsed += 0.125) {
      expect(stepBoat(b, { ...idle, boost: true }, stats, 0.125).boostStarted).toBe(false)
      expect(boostCooldownFraction(b)).toBeLessThan(fraction)
      fraction = boostCooldownFraction(b)
    }
    expect(boostReady(b)).toBe(true)
    expect(fraction).toBe(0)
    expect(stepBoat(b, { ...idle, boost: true }, stats, 0).boostStarted).toBe(true)
  })

  it.each(['boostReserve', 'boostRecovery'] as const)('purchases %s independently at the configured prices and caps at three', (id) => {
    const m = new GameModel()
    expect(m.buy(id).ok).toBe(false)
    m.credits = 1000
    const prices = id === 'boostReserve' ? [14, 28, 46] : [16, 30, 50]
    expect(UPGRADES[id].maxLevel).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(UPGRADES[id].cost(i + 1)).toBe(prices[i])
      expect(m.buy(id)).toMatchObject({ ok: true, level: i + 1, cost: prices[i] })
    }
    expect(m.credits).toBe(1000 - prices.reduce((a, b) => a + b, 0))
    expect(m.buy(id)).toMatchObject({ ok: false, reason: 'max' })
    expect(m.upgrades[id === 'boostReserve' ? 'boostRecovery' : 'boostReserve']).toBe(0)
  })

  it.each(['active', 'cooldown'])('defers purchases during %s until the next activation', (phase) => {
    const m = new GameModel()
    m.credits = 1000
    const b = createBoat()
    stepBoat(b, { ...idle, boost: true }, m.stats, 0)
    if (phase === 'cooldown') stepBoat(b, idle, m.stats, 1.5)
    const before = { ...b }
    const fraction = boostCooldownFraction(b)
    for (let i = 0; i < 3; i++) {
      expect(m.buy('boostReserve').ok).toBe(true)
      expect(m.buy('boostRecovery').ok).toBe(true)
    }
    expect(b).toEqual(before)
    expect(boostCooldownFraction(b)).toBe(fraction)
    if (phase === 'active') stepBoat(b, idle, m.stats, 1.5)
    expect(b.boostCooldown).toBe(4.5)
    stepBoat(b, idle, m.stats, 4.5)
    stepBoat(b, { ...idle, boost: true }, m.stats, 0)
    expect(b.boostLeft).toBe(3)
    expect(b.boostCycleCooldown).toBe(2.5)
  })

  it.each([0, 5])('preserves engine %i stacking, forced throttle, acceleration and steering', (engine) => {
    const stats = vesselStats({ ...noUpgrades(), engine, boostReserve: 3, boostRecovery: 3 })
    const b = createBoat(1000, 1000, 0)
    stepBoat(b, { throttle: -1, steer: 0, boost: true }, stats, 0.1)
    expect(b.vx).toBeCloseTo(stats.accel * BALANCE.boat.boostAccelMult * 0.1)
    for (let i = 0; i < 60; i++) stepBoat(b, idle, stats, 1 / 60)
    expect(b.vx).toBeCloseTo(stats.maxSpeed * 1.55)
    stepBoat(b, { ...idle, steer: 1 }, stats, 0.1)
    expect(b.heading).toBeGreaterThan(0)
  })

  it.each([2, 3])('loads old v%i upgrade records with both tracks at zero', (version) => {
    const raw = JSON.parse(JSON.stringify(buildSave(new GameModel(), createBoat())))
    raw.version = version
    delete raw.model.upgrades.boostReserve
    delete raw.model.upgrades.boostRecovery
    const parsed = parseSave(JSON.stringify(raw))!
    expect(parsed).not.toBeNull()
    expect(parsed.model.upgrades.boostReserve).toBe(0)
    expect(parsed.model.upgrades.boostRecovery).toBe(0)
  })

  it('round-trips upgrade levels while loading a stationary, boost-ready boat', () => {
    const m = new GameModel()
    m.credits = 1000
    for (let i = 0; i < 3; i++) { m.buy('boostReserve'); m.buy('boostRecovery') }
    const b = createBoat()
    stepBoat(b, { ...idle, boost: true }, m.stats, 0.5)
    const storage = new MemoryStorage()
    expect(writeSave(storage, buildSave(m, b))).toBe(true)
    const loaded = loadSave(storage)!
    expect(loaded.version).toBe(3)
    const restored = new GameModel()
    restored.restore(loaded.model)
    expect(restored.upgrades).toEqual(m.upgrades)
    const boat = createBoat(loaded.boat.x, loaded.boat.y, loaded.boat.heading)
    expect(boostReady(boat)).toBe(true)
    expect(boat.vx).toBe(0)
    stepBoat(boat, { ...idle, boost: true }, restored.stats, 0)
    expect(boat.boostLeft).toBe(3)
    expect(boat.boostCycleCooldown).toBe(2.5)
    for (const bad of [-1, 4, 1.5, '1']) {
      for (const id of ['boostReserve', 'boostRecovery']) {
        const raw = JSON.parse(JSON.stringify(buildSave(m, boat)))
        raw.model.upgrades[id] = bad
        expect(parseSave(JSON.stringify(raw))).toBeNull()
      }
    }
  })

  it('preserves v1 boolean-upgrade migration with zero boost levels', () => {
    const raw = JSON.parse(JSON.stringify(buildSave(new GameModel(), createBoat())))
    raw.version = 1
    raw.model.upgrades = { cargo: true, engine: true, width: true }
    const parsed = parseSave(JSON.stringify(raw))!
    expect(parsed.model.upgrades).toMatchObject({ cargo: 2, engine: 3, width: 3, boostReserve: 0, boostRecovery: 0 })
  })

  it('keeps pre-boost pending completions in their original board through reload', () => {
    const legacy = makeCompletion('pre-boost-run', 600, 900, 4)
    delete legacy.rules
    const m = new GameModel()
    m.completed = true
    m.completion = legacy
    const raw = parseSave(JSON.stringify(buildSave(m, createBoat())))!
    expect(raw.model.completion).toEqual(legacy)
    expect(completionBoard(legacy)).toEqual(PRE_BOOST_BOARD)
    const storage = new MemoryStorage()
    expect(submitScore(storage, { completion: raw.model.completion!, name: 'OLD' }).ok).toBe(true)
    const previous = topScores(loadScores(storage), PRE_BOOST_BOARD)
    expect(submitScore(storage, { completion: makeCompletion('boost-run', 500, 1000, 5), name: 'NEW' }).ok).toBe(true)
    expect(topScores(loadScores(storage), PRE_BOOST_BOARD)).toEqual(previous)
    expect(topScores(loadScores(storage), STANDARD_BOARD).map((e) => e.id)).toEqual(['boost-run'])
    expect(topScores(loadScores(storage), HISTORICAL_BOARD)).toEqual([])
  })
})
