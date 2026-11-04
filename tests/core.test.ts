import { describe, expect, it } from 'vitest'
import { BALANCE } from '../src/config/balance'
import { PATCHES, WORLD } from '../src/config/world'
import { createBoat, inCollectionZone, resolveCollisions, stepBoat, boostReady } from '../src/core/boat'
import { cargoCredits, cargoUnits, emptyCargo } from '../src/core/cargo'
import { ComboTracker, multiplierForChain } from '../src/core/combo'
import { GameModel } from '../src/core/model'
import {
  buildSave,
  clearSave,
  loadSave,
  loadSettings,
  MemoryStorage,
  parseSave,
  writeSave,
  writeSettings,
} from '../src/core/save'
import { vesselStats, noUpgrades } from '../src/core/stats'
import { buildObstacles, generateDebris, zoneAt, type DebrisSpawn } from '../src/core/worldgen'

/** A tiny hand-made world so tests are exact. */
function spawn(id: number, type: DebrisSpawn['type']): DebrisSpawn {
  return { id, type, x: 100 + id * 40, y: 100, rot: 0, patch: 't', zone: 'harbor' }
}
function modelWith(types: DebrisSpawn['type'][]): GameModel {
  return new GameModel(types.map((t, i) => spawn(i, t)))
}

describe('cargo capacity', () => {
  it('starts at 20 units', () => {
    expect(modelWith([]).capacity).toBe(20)
  })

  it('never overflows and never takes partial items', () => {
    // 4 nets = 16 units, then a 4-unit net would make 20 (fits), the next must be refused.
    const m = modelWith(['net', 'net', 'net', 'net', 'net', 'net'])
    for (let i = 0; i < 5; i++) expect(m.collect(i, i).ok).toBe(true)
    expect(m.cargoUsed).toBe(20)
    const refused = m.collect(5, 6)
    expect(refused).toEqual({ ok: false, reason: 'full' })
    expect(m.cargoUsed).toBe(20)
    expect(m.isRemoved(5)).toBe(false)
  })

  it('rejects an item that would not fit even if smaller ones would', () => {
    const m = modelWith([...Array(8).fill('container'), 'container', 'net', 'bottle'] as DebrisSpawn['type'][])
    for (let i = 0; i < 8; i++) m.collect(i, i) // 16 units
    expect(m.cargoFree).toBe(4)
    expect(m.collect(8, 9).ok).toBe(true) // container -> 18
    expect(m.collect(9, 10)).toEqual({ ok: false, reason: 'full' }) // net needs 4, 2 free
    expect(m.collect(10, 11).ok).toBe(true) // a bottle still fits
    expect(m.cargoUsed).toBe(19)
  })

  it('cannot collect the same debris twice', () => {
    const m = modelWith(['bottle'])
    expect(m.collect(0, 0).ok).toBe(true)
    expect(m.collect(0, 1)).toEqual({ ok: false, reason: 'gone' })
  })
})

describe('credits and unloading', () => {
  it('pays 2 / 4 / 10 credits for bottle / container / net and uses 1 / 2 / 4 cargo', () => {
    const c = { bottle: 1, container: 1, net: 1 }
    expect(cargoUnits(c)).toBe(7)
    expect(cargoCredits(c)).toBe(16)
    expect(BALANCE.debris.bottle).toMatchObject({ cargo: 1, credits: 2 })
    expect(BALANCE.debris.container).toMatchObject({ cargo: 2, credits: 4 })
    expect(BALANCE.debris.net).toMatchObject({ cargo: 4, credits: 10 })
  })

  it('awards exact credits on unload and empties the hold', () => {
    const m = modelWith(['bottle', 'bottle', 'container', 'net'])
    for (let i = 0; i < 4; i++) m.collect(i, i * 10) // slow: no combo
    expect(m.credits).toBe(0) // credits come only at the station
    const r = m.unload()
    expect(r.credits).toBe(2 + 2 + 4 + 10)
    expect(r.units).toBe(1 + 1 + 2 + 4)
    expect(m.credits).toBe(18)
    expect(m.cargoUsed).toBe(0)
    expect(m.cargo).toEqual(emptyCargo())
  })

  it('unloading an empty hold pays nothing', () => {
    const m = modelWith([])
    expect(m.unload().credits).toBe(0)
  })
})

describe('upgrades', () => {
  it('has the specified costs and effects', () => {
    expect(BALANCE.upgrades.cargo.cost).toBe(50)
    expect(BALANCE.upgrades.engine.cost).toBe(60)
    expect(BALANCE.upgrades.width.cost).toBe(75)
    const base = vesselStats(noUpgrades())
    expect(vesselStats({ ...noUpgrades(), cargo: true }).capacity).toBe(base.capacity + 10)
    expect(vesselStats({ ...noUpgrades(), engine: true }).maxSpeed).toBeCloseTo(base.maxSpeed * 1.15)
    expect(vesselStats({ ...noUpgrades(), width: true }).zoneHalfWidth).toBeCloseTo(base.zoneHalfWidth * 1.25)
  })

  it('requires enough credits, deducts the cost and can only be bought once', () => {
    const m = modelWith([])
    m.credits = 49
    expect(m.buy('cargo')).toEqual({ ok: false, reason: 'poor' })
    expect(m.credits).toBe(49)
    m.credits = 60
    expect(m.buy('cargo')).toMatchObject({ ok: true, cost: 50 })
    expect(m.credits).toBe(10)
    expect(m.capacity).toBe(30)
    m.credits = 500
    expect(m.buy('cargo')).toEqual({ ok: false, reason: 'owned' })
    expect(m.credits).toBe(500)
    expect(m.buy('engine').ok).toBe(true)
    expect(m.buy('width').ok).toBe(true)
    expect(m.credits).toBe(500 - 60 - 75)
    expect(m.allUpgradesOwned()).toBe(true)
  })

  it('makes the boat faster and the zone wider in play', () => {
    const run = (engine: boolean) => {
      const stats = vesselStats({ ...noUpgrades(), engine })
      const b = createBoat(1000, 1000, 0)
      for (let i = 0; i < 240; i++) stepBoat(b, { throttle: 1, steer: 0, boost: false }, stats, 1 / 60)
      return b.x
    }
    expect(run(true)).toBeGreaterThan(run(false) * 1.0 + 0) // further travelled in the same time
    const narrow = vesselStats(noUpgrades())
    const wide = vesselStats({ ...noUpgrades(), width: true })
    const boat = { x: 0, y: 0, heading: 0 }
    const sideY = narrow.zoneHalfWidth + 6
    expect(inCollectionZone(boat, 50, sideY, 10, narrow)).toBe(false)
    expect(inCollectionZone(boat, 50, sideY, 10, wide)).toBe(true)
  })
})

describe('combos', () => {
  it('uses the 3 / 5 / 10 chain thresholds', () => {
    expect(multiplierForChain(1)).toBe(1)
    expect(multiplierForChain(2)).toBe(1)
    expect(multiplierForChain(3)).toBe(1.2)
    expect(multiplierForChain(4)).toBe(1.2)
    expect(multiplierForChain(5)).toBe(1.5)
    expect(multiplierForChain(9)).toBe(1.5)
    expect(multiplierForChain(10)).toBe(2)
    expect(multiplierForChain(40)).toBe(2)
  })

  it('resets after the window without a pickup', () => {
    const c = new ComboTracker()
    c.register(0)
    c.register(1)
    expect(c.register(2).chain).toBe(3)
    expect(c.expire(2 + BALANCE.combo.window - 0.1)).toBe(false)
    expect(c.expire(2 + BALANCE.combo.window + 0.1)).toBe(true)
    expect(c.chain).toBe(0)
    expect(c.register(20).chain).toBe(1)
    expect(c.best).toBe(3)
  })

  it('affects score only - never cargo or credits', () => {
    const quick = modelWith(Array(10).fill('bottle') as DebrisSpawn['type'][])
    const slow = modelWith(Array(10).fill('bottle') as DebrisSpawn['type'][])
    for (let i = 0; i < 10; i++) {
      quick.collect(i, i * 0.5) // chain builds to 10
      slow.collect(i, i * 10) // chain never builds
    }
    expect(quick.score).toBeGreaterThan(slow.score)
    expect(quick.cargoUsed).toBe(slow.cargoUsed)
    expect(quick.unload().credits).toBe(slow.unload().credits)
    expect(quick.credits).toBe(20)
    // 10 bottles: x1,x1,x1.2 (3-4), x1.5 (5-9), x2 (10)
    const expected = [1, 1, 1.2, 1.2, 1.5, 1.5, 1.5, 1.5, 1.5, 2].map((mult) => Math.round(10 * mult))
    expect(quick.score).toBe(expected.reduce((a, b) => a + b, 0))
  })
})

describe('cleanup progress', () => {
  it('measures the share of starting debris units removed', () => {
    // 4 bottles + 2 nets = 12 units total
    const m = modelWith(['bottle', 'bottle', 'bottle', 'bottle', 'net', 'net'])
    expect(m.totalUnits).toBe(12)
    expect(m.progress).toBe(0)
    m.collect(4, 0) // net: 4 / 12
    expect(m.progress).toBeCloseTo(4 / 12)
    m.collect(0, 1)
    m.collect(1, 2)
    expect(m.progress).toBeCloseTo(6 / 12)
  })

  it('fires the 25 / 50 / 75% milestones exactly once and completes at 75%', () => {
    const m = modelWith(Array(20).fill('bottle') as DebrisSpawn['type'][])
    const seen: number[] = []
    for (let i = 0; i < 20; i++) {
      const r = m.collect(i, i * 5)
      if (r.ok) seen.push(...r.newMilestones)
      if (i === 3) expect(m.completed).toBe(false)
      if (m.cargoFree === 0) m.unload()
    }
    expect(seen).toEqual([0.25, 0.5, 0.75])
    expect(m.completed).toBe(true)
  })

  it('cargo removed from the sea counts even before it is unloaded', () => {
    const m = modelWith(['bottle', 'bottle'])
    m.collect(0, 0)
    expect(m.progress).toBe(0.5)
    expect(m.credits).toBe(0)
  })
})

describe('save and load', () => {
  it('round-trips the full game state', () => {
    const m = new GameModel()
    const ids = m.spawns.slice(0, 12).map((s) => s.id)
    ids.forEach((id, i) => m.collect(id, i * 8))
    m.unload()
    m.credits = 130
    m.buy('engine')
    const boat = createBoat(1234, 2345, 1.5)
    const store = new MemoryStorage()
    expect(writeSave(store, buildSave(m, boat, 42))).toBe(true)

    const loaded = loadSave(store, new Set(m.spawns.map((s) => s.id)))
    expect(loaded).not.toBeNull()
    const restored = new GameModel()
    restored.restore(loaded!.model)
    expect(restored.credits).toBe(m.credits)
    expect(restored.score).toBe(m.score)
    expect(restored.upgrades).toEqual(m.upgrades)
    expect(restored.progress).toBeCloseTo(m.progress)
    expect([...restored.removed]).toEqual([...m.removed])
    expect(loaded!.boat).toEqual({ x: 1234, y: 2345, heading: 1.5 })
    expect(restored.capacity).toBe(m.capacity)
  })

  it('keeps unloaded cargo in the hold across a reload', () => {
    const m = modelWith(['bottle', 'net'])
    m.collect(0, 0)
    m.collect(1, 9)
    const store = new MemoryStorage()
    writeSave(store, buildSave(m, createBoat()))
    const r = modelWith(['bottle', 'net'])
    r.restore(loadSave(store)!.model)
    expect(r.cargoUsed).toBe(5)
  })

  it('rejects corrupt, tampered or foreign saves', () => {
    expect(parseSave(null)).toBeNull()
    expect(parseSave('not json')).toBeNull()
    expect(parseSave('{"version":99}')).toBeNull()
    const good = JSON.parse(JSON.stringify(buildSave(new GameModel(), createBoat())))
    expect(parseSave(JSON.stringify(good))).not.toBeNull()
    expect(parseSave(JSON.stringify({ ...good, seed: good.seed + 1 }))).toBeNull()
    const bad = JSON.parse(JSON.stringify(good))
    bad.model.cargo.bottle = 99 // more than the hold can contain
    expect(parseSave(JSON.stringify(bad))).toBeNull()
    const neg = JSON.parse(JSON.stringify(good))
    neg.model.credits = -5
    expect(parseSave(JSON.stringify(neg))).toBeNull()
  })

  it('clears progress for New Game and keeps the mute setting separately', () => {
    const store = new MemoryStorage()
    writeSave(store, buildSave(new GameModel(), createBoat()))
    writeSettings(store, { muted: true })
    clearSave(store)
    expect(loadSave(store)).toBeNull()
    expect(loadSettings(store).muted).toBe(true)
  })
})

describe('deterministic debris placement', () => {
  it('produces identical output for the same seed', () => {
    expect(generateDebris(WORLD.seed)).toEqual(generateDebris(WORLD.seed))
  })

  it('changes with a different seed but keeps patch counts', () => {
    const a = generateDebris(1)
    const b = generateDebris(2)
    expect(a).not.toEqual(b)
    expect(a.length).toBe(b.length)
  })

  it('places every requested item, clear of obstacles and inside the world', () => {
    const spawns = generateDebris()
    const wanted = PATCHES.reduce((n, p) => n + p.counts.bottle + p.counts.container + p.counts.net, 0)
    expect(spawns.length).toBe(wanted)
    const obstacles = buildObstacles()
    for (const s of spawns) {
      expect(s.x).toBeGreaterThan(0)
      expect(s.y).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(WORLD.width)
      expect(s.y).toBeLessThan(WORLD.height)
      for (const o of obstacles) expect(Math.hypot(o.x - s.x, o.y - s.y)).toBeGreaterThan(o.r)
    }
    expect(new Set(spawns.map((s) => s.id)).size).toBe(spawns.length)
  })

  it('spreads debris over all three areas with larger patches farther out', () => {
    const spawns = generateDebris()
    const count = (z: string) => spawns.filter((s) => zoneAt(s.x, s.y) === z).length
    expect(count('harbor')).toBeGreaterThan(10)
    expect(count('shallows')).toBeGreaterThan(count('harbor'))
    expect(count('open')).toBeGreaterThan(count('shallows'))
    const nets = (z: string) => spawns.filter((s) => s.type === 'net' && zoneAt(s.x, s.y) === z).length
    expect(nets('open')).toBeGreaterThan(nets('harbor'))
  })
})

describe('boat handling', () => {
  const stats = vesselStats(noUpgrades())
  const dt = 1 / 60

  it('accelerates gently, then coasts to a stop with limited momentum', () => {
    const b = createBoat(1000, 1000, 0)
    stepBoat(b, { throttle: 1, steer: 0, boost: false }, stats, dt)
    expect(Math.hypot(b.vx, b.vy)).toBeLessThan(stats.maxSpeed * 0.1)
    for (let i = 0; i < 180; i++) stepBoat(b, { throttle: 1, steer: 0, boost: false }, stats, dt)
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(stats.maxSpeed, 0)
    for (let i = 0; i < 180; i++) stepBoat(b, { throttle: 0, steer: 0, boost: false }, stats, dt)
    expect(Math.hypot(b.vx, b.vy)).toBeLessThan(stats.maxSpeed * 0.05)
  })

  it('reverses slower than it goes forward', () => {
    const b = createBoat(1000, 1000, 0)
    for (let i = 0; i < 240; i++) stepBoat(b, { throttle: -1, steer: 0, boost: false }, stats, dt)
    expect(b.vx).toBeLessThan(0)
    expect(Math.abs(b.vx)).toBeLessThan(stats.maxSpeed * 0.5)
  })

  it('boosts temporarily, then needs a cooldown', () => {
    const b = createBoat(1000, 1000, 0)
    let peak = 0
    stepBoat(b, { throttle: 0, steer: 0, boost: true }, stats, dt)
    for (let i = 0; i < 90; i++) {
      stepBoat(b, { throttle: 0, steer: 0, boost: false }, stats, dt)
      peak = Math.max(peak, Math.hypot(b.vx, b.vy))
    }
    expect(peak).toBeGreaterThan(stats.maxSpeed * 1.2)
    expect(boostReady(b)).toBe(false)
    for (let i = 0; i < 60 * 8; i++) stepBoat(b, { throttle: 0, steer: 0, boost: false }, stats, dt)
    expect(boostReady(b)).toBe(true)
  })

  it('collides with islands without damage and slides along them', () => {
    const b = createBoat(0, 0, 0)
    b.x = -40
    b.vx = 200
    const wall = { x: 0, y: 0, r: 30 }
    const impact = resolveCollisions(b, [wall])
    expect(impact).toBeGreaterThan(100)
    expect(Math.hypot(b.x, b.y)).toBeGreaterThanOrEqual(30 + BALANCE.boat.radius - 0.001)
    b.x = -48
    b.y = -10
    b.vx = 150
    b.vy = 150
    resolveCollisions(b, [wall])
    expect(Math.abs(b.vy)).toBeGreaterThan(40) // keeps sliding
  })

  it('collects only inside the zone in front of the bow', () => {
    const boat = { x: 500, y: 500, heading: 0 }
    expect(inCollectionZone(boat, 560, 500, 10, stats)).toBe(true)
    expect(inCollectionZone(boat, 440, 500, 10, stats)).toBe(false) // behind
    expect(inCollectionZone(boat, 700, 500, 10, stats)).toBe(false) // too far ahead
    expect(inCollectionZone(boat, 560, 600, 10, stats)).toBe(false) // too far aside
  })
})
