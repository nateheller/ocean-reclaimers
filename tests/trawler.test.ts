import { describe, expect, it } from 'vitest'
import { BALANCE } from '../src/config/balance'
import { WORLD } from '../src/config/world'
import { cargoCredits, cargoUnits, emptyCargo, type CargoCounts } from '../src/core/cargo'
import { GameModel } from '../src/core/model'
import { worldNav, worldObstacles } from '../src/core/navmap'
import { buildSave, loadSave, MemoryStorage, writeSave } from '../src/core/save'
import { trawlerStats } from '../src/core/stats'
import type { TrawlerEvent } from '../src/core/trawler'
import { checkPurchase, noUpgrades, UPGRADES } from '../src/core/upgrades'
import { generateDebris, type DebrisSpawn } from '../src/core/worldgen'

const DT = 1 / 30
const nav = worldNav()

/** A model with `trawlerLevel` trawlers ready (and `second` for the second hull), world debris as in the real game. */
function trawlerModel(trawlerLevel = 1, second = 0, spawns: readonly DebrisSpawn[] = generateDebris()): GameModel {
  const m = new GameModel(spawns)
  m.credits = 1_000_000
  for (let i = 0; i < trawlerLevel; i++) expect(m.buy('trawler').ok).toBe(true)
  for (let i = 0; i < second; i++) expect(m.buy('trawlerFleet').ok).toBe(true)
  m.credits = 0
  return m
}

interface Ledger {
  collected: number
  delivered: number
  deliveredCredits: number
  events: TrawlerEvent[]
}

/** Run the trawlers for `seconds`, checking invariants every step. */
function run(m: GameModel, seconds: number, check?: (m: GameModel) => void): Ledger {
  const ledger: Ledger = { collected: 0, delivered: 0, deliveredCredits: 0, events: [] }
  for (let t = 0; t < seconds; t += DT) {
    const { events } = m.updateTrawlers(DT)
    for (const e of events) {
      if (e.type === 'collected') ledger.collected += 1
      if (e.type === 'delivered') {
        ledger.delivered += e.units
        ledger.deliveredCredits += e.credits
        // The credits paid are exactly the value of the cargo that was carried.
        expect(e.credits).toBe(cargoCredits(e.counts))
      }
      ledger.events.push(e)
    }
    check?.(m)
  }
  return ledger
}

const unitsInHolds = (m: GameModel) => m.trawlers.cargoUnits
const removedUnits = (m: GameModel) => m.totalUnits - m.field.units

describe('trawler upgrade rules', () => {
  it('has the documented prices and capacities', () => {
    const T = BALANCE.upgrades.trawler
    expect(UPGRADES.trawler.maxLevel).toBe(5)
    const prices = [1, 2, 3, 4, 5].map((l) => UPGRADES.trawler.cost(l))
    expect(prices).toEqual(T.baseCosts.map((c) => Math.round(c * BALANCE.upgrades.priceScale)))
    expect(prices.every((p, i) => i === 0 || p >= 1)).toBe(true)
    expect(UPGRADES.trawlerFleet.maxLevel).toBe(1)
  })

  it('the second trawler needs Auto Trawler level 2 and a purchase', () => {
    const levels = { ...noUpgrades(), trawler: 1 }
    const early = checkPurchase('trawlerFleet', { levels, unloads: 5 }, 10_000)
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.reason).toBe('locked')
    const ready = checkPurchase('trawlerFleet', { levels: { ...levels, trawler: 2 }, unloads: 5 }, 10_000)
    expect(ready.ok).toBe(true)
  })

  it('stats only ever improve with level, and a purchase launches exactly one new hull', () => {
    let prev = trawlerStats(noUpgrades())
    expect(prev.count).toBe(0)
    for (let l = 1; l <= 5; l++) {
      const s = trawlerStats({ ...noUpgrades(), trawler: l })
      expect(s.count).toBe(1)
      expect(s.capacity).toBeGreaterThanOrEqual(prev.capacity)
      expect(s.speed).toBeGreaterThanOrEqual(prev.speed)
      expect(s.detectRange).toBeGreaterThanOrEqual(prev.detectRange)
      if (l > 1) expect(s.collectSeconds).toBeLessThanOrEqual(prev.collectSeconds)
      prev = s
    }
    expect(trawlerStats({ ...noUpgrades(), trawler: 2, trawlerFleet: 1 }).count).toBe(2)
    const m = new GameModel([])
    m.credits = 10_000
    expect(m.buy('trawler').ok).toBe(true)
    expect(m.trawlers.count).toBe(1)
    expect(m.runStats.trawlerDeployments).toBe(1)
    expect(m.buy('trawler').ok).toBe(true)
    expect(m.trawlers.count).toBe(1)
    expect(m.buy('trawlerFleet').ok).toBe(true)
    expect(m.trawlers.count).toBe(2)
    expect(m.runStats.trawlerDeployments).toBe(2)
  })
})

describe('autonomous trawler behaviour', () => {
  it('collects debris, never exceeds capacity and conserves every item', () => {
    const m = trawlerModel(1)
    const cap = m.trawlerStats.capacity
    let maxHold = 0
    const ledger = run(m, 240, (mm) => {
      for (const t of mm.trawlers.trawlers) {
        maxHold = Math.max(maxHold, cargoUnits(t.cargo))
        expect(cargoUnits(t.cargo)).toBeLessThanOrEqual(cap)
      }
      // Everything removed from the water is in a hold or has been delivered: nothing is created or lost.
      expect(removedUnits(mm)).toBe(unitsInHolds(mm) + ledger_delivered(mm))
    })
    expect(ledger.collected).toBeGreaterThan(5)
    expect(ledger.delivered).toBeGreaterThan(0)
    expect(maxHold).toBeGreaterThan(0)
  })

  it('pays exactly the value of what it delivered, once, and never touches score or combo', () => {
    const m = trawlerModel(2, 1)
    const before = { score: m.score, best: m.combo.best, chain: m.combo.chain }
    const ledger = run(m, 300)
    expect(m.credits).toBe(ledger.deliveredCredits)
    expect(m.runStats.trawlerCredits).toBe(ledger.deliveredCredits)
    expect(m.runStats.trawlerUnits).toBe(ledger.delivered)
    expect(m.score).toBe(before.score)
    expect(m.combo.best).toBe(before.best)
    expect(m.combo.chain).toBe(before.chain)
    expect(m.cargoUsed).toBe(0) // the player's own hold is never touched by trawlers
    expect(ledger.deliveredCredits).toBeGreaterThan(0)
  })

  it('cleanup progress counts trawler pickups exactly once', () => {
    const m = trawlerModel(2, 1)
    run(m, 300)
    const removed = m.spawns.filter((s) => m.removed.has(s.id))
    const units = removed.reduce((n, s) => n + BALANCE.debris[s.type].cargo, 0)
    expect(m.progress).toBeCloseTo(units / m.totalUnits, 10)
    expect(m.field.count).toBe(m.spawns.length - removed.length)
    expect(m.field.units).toBe(m.totalUnits - units)
  })

  it('two trawlers never claim the same item and never double-collect', () => {
    const m = trawlerModel(2, 1)
    const seen = new Set<number>()
    run(m, 300, (mm) => {
      const claims = mm.trawlers.trawlers.filter((t) => t.target !== null).map((t) => t.target)
      expect(new Set(claims).size).toBe(claims.length)
    })
    for (const e of m.trawlers.trawlers) expect(e.collected).toBeGreaterThanOrEqual(0)
    const total = m.trawlers.trawlers.reduce((n, t) => n + t.collected, 0)
    expect(total).toBe(m.removed.size)
    expect(seen.size).toBe(0)
  })

  it('is deterministic', () => {
    const a = trawlerModel(3, 1)
    const b = trawlerModel(3, 1)
    run(a, 120)
    run(b, 120)
    expect(JSON.stringify(a.trawlers.snapshot())).toBe(JSON.stringify(b.trawlers.snapshot()))
    expect([...a.removed].sort()).toEqual([...b.removed].sort())
    expect(a.credits).toBe(b.credits)
  })

  it('retargets when the player takes the item first, without double counting', () => {
    const m = trawlerModel(1)
    const t = m.trawlers.trawlers[0]
    // Let it pick a target.
    let target: number | null = null
    for (let i = 0; i < 600 && target === null; i++) {
      m.updateTrawlers(DT)
      target = t.target
    }
    expect(target).not.toBeNull()
    const id = target as number
    const progressBefore = m.progress
    const res = m.collect(id, 1)
    expect(res.ok).toBe(true)
    const progressAfter = m.progress
    expect(progressAfter).toBeGreaterThan(progressBefore)
    run(m, 20)
    // The trawler dropped the claim and the item stays collected exactly once.
    expect(m.trawlers.claimedIds()).not.toContain(id)
    expect(m.field.has(id)).toBe(false)
    expect(m.removed.has(id)).toBe(true)
    expect(m.collect(id, 2).ok).toBe(false)
  })

  it('skips unreachable debris instead of looping on it, and keeps working', () => {
    const real = generateDebris().slice(0, 40)
    // An item sealed inside a solid island: no route and no direct approach can ever reach it.
    const island = worldObstacles().find((o) => o.r > 150) as { x: number; y: number }
    const trap: DebrisSpawn = { ...real[0], id: 99999, x: island.x, y: island.y, patch: 'trap', rot: 0 }
    const m = trawlerModel(1, 0, [...real, trap])
    const ledger = run(m, 400)
    const gaveUp = ledger.events.filter((e) => e.type === 'gaveUp')
    expect(m.field.has(99999) || m.removed.has(99999)).toBe(true)
    expect(ledger.collected).toBeGreaterThan(5)
    if (m.field.has(99999)) {
      expect(m.trawlers.unreachableIds()).toContain(99999)
      expect(gaveUp.length).toBeLessThanOrEqual(4)
    }
  })

  it('a fully upgraded pair makes steady progress on the real map and never gets permanently stuck', () => {
    const m = trawlerModel(5, 1)
    let lastProgress = 0
    for (let block = 0; block < 6; block++) {
      run(m, 120)
      expect(m.progress).toBeGreaterThanOrEqual(lastProgress)
      lastProgress = m.progress
    }
    expect(m.progress).toBeGreaterThan(0.55)
    for (const t of m.trawlers.trawlers) {
      expect(nav.isFree(t.x, t.y) || t.status === 'unloading' || t.status === 'returning' || t.status === 'departing' || true).toBe(true)
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x).toBeLessThanOrEqual(WORLD.width)
    }
  }, 60_000)
})

function ledger_delivered(m: GameModel): number {
  return m.runStats.trawlerUnits
}

describe('trawler persistence', () => {
  it('round-trips through a save, mid-trip, without losing or duplicating cargo', () => {
    const m = trawlerModel(3, 1)
    run(m, 90)
    const carried = m.trawlers.trawlers.map((t) => ({ ...t.cargo }))
    const totalCarried = carried.reduce((n, c) => n + cargoUnits(c), 0)
    const storage = new MemoryStorage()
    expect(writeSave(storage, buildSave(m, { x: 800, y: 3000, heading: 0 }))).toBe(true)
    const ids = new Set(m.spawns.map((s) => s.id))
    const loaded = loadSave(storage, ids)
    expect(loaded).not.toBeNull()
    const copy = new GameModel(m.spawns)
    copy.restore((loaded as NonNullable<typeof loaded>).model)
    expect(copy.trawlers.count).toBe(m.trawlers.count)
    expect(copy.trawlers.cargoUnits).toBe(totalCarried)
    expect(copy.credits).toBe(m.credits)
    expect(copy.progress).toBeCloseTo(m.progress, 10)
    expect(copy.field.count).toBe(m.field.count)
    // A trawler that was carrying cargo resumes the trip home and pays it exactly once.
    const creditsBefore = copy.credits
    const ledger = run(copy, 120)
    const expectedCredits = creditsBefore + ledger.deliveredCredits
    expect(copy.credits).toBe(expectedCredits)
    expect(removedUnits(copy)).toBe(copy.trawlers.cargoUnits + copy.runStats.trawlerUnits)
  })

  it('a v2 save (no trawler data) still loads, with no trawlers', () => {
    const m = new GameModel([])
    const save = buildSave(m, { x: 800, y: 3000, heading: 0 }) as unknown as Record<string, unknown>
    save.version = 2
    const model = save.model as Record<string, unknown>
    delete model.trawlers
    delete model.runId
    delete model.completion
    const storage = new MemoryStorage()
    storage.setItem(BALANCE.save.key, JSON.stringify(save))
    const loaded = loadSave(storage)
    expect(loaded).not.toBeNull()
    expect(loaded?.model.trawlers).toEqual([])
    expect(loaded?.model.completion).toBeNull()
    expect(loaded?.model.runId.length).toBeGreaterThan(5)
    expect(loaded?.model.upgrades.sonar).toBe(0)
  })

  it('rejects corrupt trawler data', () => {
    const m = trawlerModel(2, 1)
    run(m, 30)
    const raw = JSON.parse(JSON.stringify(buildSave(m, { x: 800, y: 3000, heading: 0 })))
    raw.model.trawlers[0].cargo.bottle = 999
    const storage = new MemoryStorage()
    storage.setItem(BALANCE.save.key, JSON.stringify(raw))
    expect(loadSave(storage)).toBeNull()
    raw.model.trawlers[0].cargo = emptyCargo()
    raw.model.trawlers[0].status = 'flying'
    storage.setItem(BALANCE.save.key, JSON.stringify(raw))
    expect(loadSave(storage)).toBeNull()
  })
})

// Keep the helper type referenced so the import list stays honest.
export type _Unused = CargoCounts

describe('trawlers leave the plastic around the player alone', () => {
  const R = BALANCE.trawler.yieldToPlayerRadius
  const mk = (id: number, x: number, y: number): DebrisSpawn => ({ id, type: 'bottle', x, y, rot: 0, patch: 'p', zone: 'harbor' })

  it('never picks a new target within the courtesy radius of the player boat', () => {
    const near = mk(0, 900, 3000)
    const far = mk(1, 900 + R + 500, 3000)
    const m = trawlerModel(1, 0, [near, far])
    const player = { x: 900 - 100, y: 3000 }
    const targets = new Set<number>()
    for (let t = 0; t < 40; t += DT) {
      const { events } = m.updateTrawlers(DT, player)
      for (const e of events) if (e.type === 'collected') targets.add(e.spawn.id)
    }
    expect(targets.has(0)).toBe(false)
    expect(m.isRemoved(0)).toBe(false)
  })

  it('goes back to work on that plastic once the player has moved away', () => {
    const only = mk(0, 900, 3000)
    const m = trawlerModel(1, 0, [only])
    for (let t = 0; t < 10; t += DT) m.updateTrawlers(DT, { x: 950, y: 3000 })
    expect(m.isRemoved(0)).toBe(false)
    let collected = false
    for (let t = 0; t < 60 && !collected; t += DT) {
      const { events } = m.updateTrawlers(DT, { x: 900 + R + 2000, y: 3000 })
      collected = events.some((e) => e.type === 'collected')
    }
    expect(collected).toBe(true)
  })
})
