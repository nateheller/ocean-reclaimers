import { describe, expect, it } from 'vitest'
import { BALANCE } from '../src/config/balance'
import { WORLD } from '../src/config/world'
import { cargoCredits, cargoUnits, emptyCargo, type CargoCounts } from '../src/core/cargo'
import { GameModel, type PlayerRef } from '../src/core/model'
import { worldNav, worldObstacles } from '../src/core/navmap'
import { buildObstacles } from '../src/core/worldgen'
import { buildSave, loadSave, MemoryStorage, writeSave } from '../src/core/save'
import { createBoat } from '../src/core/boat'
import { tenderStats } from '../src/core/stats'
import { splitCargo, TENDER_STATUS_LABEL, type TenderEvent, type TenderStatus } from '../src/core/tender'
import { noUpgrades, UPGRADES } from '../src/core/upgrades'

const DT = 1 / 30
const nav = worldNav()
const obstacles = worldObstacles()

/** A model with no map debris, rich enough to buy anything, with `tenderLevel` tenders ready. */
function fleetModel(tenderLevel = 1, fleet = 0): GameModel {
  const m = new GameModel([])
  m.credits = 100_000
  m.runStats.unloads = 10 // past the "visit the station" gate
  for (let i = 0; i < tenderLevel; i++) expect(m.buy('tender').ok).toBe(true)
  for (let i = 0; i < fleet; i++) expect(m.buy('fleet').ok).toBe(true)
  m.credits = 0
  return m
}

function player(x = 1500, y = 2700): PlayerRef {
  const p = nav.nearestFree(x, y) as { x: number; y: number }
  return { x: p.x, y: p.y, vx: 0, vy: 0, heading: 0 }
}

/** Run the fleet for up to `seconds`, returning every event; stops early when `until` returns true. */
function run(m: GameModel, p: PlayerRef, seconds: number, until?: (e: TenderEvent[]) => boolean, onStep?: () => void): TenderEvent[] {
  const all: TenderEvent[] = []
  for (let t = 0; t < seconds; t += DT) {
    const ev = m.updateFleet(DT, p)
    all.push(...ev)
    onStep?.()
    if (until?.(all)) break
  }
  return all
}

const delivered = (ev: TenderEvent[]) => ev.filter((e): e is Extract<TenderEvent, { type: 'delivered' }> => e.type === 'delivered')
const totalSystemUnits = (m: GameModel) => m.cargoUsed + m.fleet.cargoUnits

describe('cargo splitting', () => {
  it('conserves every item and never exceeds the limit (randomised)', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
    for (let n = 0; n < 500; n++) {
      const src: CargoCounts = { bottle: Math.floor(rnd() * 12), container: Math.floor(rnd() * 8), net: Math.floor(rnd() * 5) }
      const max = Math.floor(rnd() * 30)
      const { taken, remaining } = splitCargo(src, max)
      expect(cargoUnits(taken)).toBeLessThanOrEqual(max)
      for (const k of ['bottle', 'container', 'net'] as const) expect(taken[k] + remaining[k]).toBe(src[k])
      expect(Math.min(...Object.values(taken), ...Object.values(remaining))).toBeGreaterThanOrEqual(0)
    }
  })

  it('never takes a partial item', () => {
    const { taken, remaining } = splitCargo({ bottle: 0, container: 0, net: 3 }, 10)
    expect(taken).toEqual({ bottle: 0, container: 0, net: 2 }) // 8 units; a third net would need 12
    expect(remaining.net).toBe(1)
  })
})

describe('tender upgrades', () => {
  it('unlocks only after several station visits', () => {
    const m = new GameModel([])
    m.credits = 1000
    expect(m.canBuy('tender')).toMatchObject({ ok: false, reason: 'locked' })
    m.runStats.unloads = BALANCE.upgrades.tender.minUnloadsToBuy
    expect(m.canBuy('tender').ok).toBe(true)
  })

  it('level table: 10 -> 15 -> faster -> 25 -> auto dispatch', () => {
    const stats = [1, 2, 3, 4, 5].map((l) => tenderStats({ ...noUpgrades(), tender: l }))
    expect(stats.map((s) => s.capacity)).toEqual([10, 15, 15, 25, 25])
    expect(stats[2].speed).toBeGreaterThan(stats[1].speed)
    expect(stats.map((s) => s.autoDispatch)).toEqual([false, false, false, false, true])
    expect(tenderStats(noUpgrades())).toMatchObject({ count: 0, capacity: 0 })
  })

  it('buying level 1 launches the first tender; the second tender needs level 2 and adds one more', () => {
    const m = fleetModel(0)
    m.runStats.unloads = 5
    m.credits = 10_000
    expect(m.fleet.count).toBe(0)
    m.buy('tender')
    expect(m.fleet.count).toBe(1)
    expect(m.canBuy('fleet')).toMatchObject({ ok: false, reason: 'locked' })
    m.buy('tender')
    expect(m.buy('fleet').ok).toBe(true)
    expect(m.fleet.count).toBe(2)
    expect(m.fleet.tenders[0].id).not.toBe(m.fleet.tenders[1].id)
    expect(m.buy('fleet')).toMatchObject({ ok: false, reason: 'max' })
    expect(m.fleet.count).toBe(BALANCE.tender.maxTenders)
  })

  it('every tender level has a price and the whole track is configurable', () => {
    const costs = [1, 2, 3, 4, 5].map((l) => UPGRADES.tender.cost(l))
    expect(costs.every((c) => c > 0)).toBe(true)
    expect(BALANCE.upgrades.tender.baseCosts).toHaveLength(5)
  })
})

describe('cargo tender delivery loop', () => {
  it('requesting without a tender, with an empty hold, or with every tender busy changes nothing', () => {
    const none = new GameModel([])
    none.cargo = { bottle: 3, container: 0, net: 0 }
    expect(none.requestTender(player()).result).toEqual({ ok: false, reason: 'none' })

    const m = fleetModel()
    expect(m.requestTender(player()).result).toEqual({ ok: false, reason: 'empty' })
    expect(m.fleet.tenders[0].status).toBe('idle')

    m.cargo = { bottle: 5, container: 0, net: 0 }
    expect(m.requestTender(player()).result.ok).toBe(true)
    // The only tender is already on its way and will take all five bottles.
    expect(m.requestTender(player()).result).toEqual({ ok: false, reason: 'claimed' })
    // With more cargo than one tender can carry the second request is genuinely busy, not claimed.
    const big = fleetModel()
    big.cargo = { bottle: 14, container: 0, net: 0 }
    expect(big.requestTender(player()).result.ok).toBe(true)
    expect(big.requestTender(player()).result).toEqual({ ok: false, reason: 'busy' })
  })
  it('does not send a second tender for cargo that the first one is already coming for', () => {
    const m = fleetModel(2, 1)
    m.cargo = { bottle: 8, container: 0, net: 0 }
    expect(m.requestTender(player()).result.ok).toBe(true)
    expect(m.requestTender(player()).result).toEqual({ ok: false, reason: 'claimed' })
    expect(m.fleet.tenders.filter((t) => t.status === 'idle')).toHaveLength(1)
    // A hold that exceeds one tender's capacity (15) is shared out between two tenders.
    const two = fleetModel(2, 1)
    two.cargo = { bottle: 20, container: 0, net: 0 }
    expect(two.requestTender(player()).result.ok).toBe(true)
    expect(two.requestTender(player()).result.ok).toBe(true)
  })

  it('collects, delivers and pays - credits arrive only after delivery, and cargo is conserved at every step', () => {
    const m = fleetModel()
    const p = player()
    m.cargo = { bottle: 4, container: 2, net: 1 } // 4 + 4 + 4 = 12 units, 8 + 8 + 10 = 26 credits
    const startUnits = cargoUnits(m.cargo)
    expect(startUnits).toBe(12)
    const req = m.requestTender(p)
    expect(req.result.ok).toBe(true)
    expect(m.credits).toBe(0) // not paid at dispatch

    const events = run(
      m,
      p,
      180,
      (ev) => delivered(ev).length > 0,
      () => {
        // Nothing is paid until the delivery event; cargo in transit is always accounted for.
        if (m.runStats.tenderDeliveries === 0) expect(m.credits).toBe(0)
        expect(totalSystemUnits(m) + m.runStats.tenderUnits).toBe(startUnits)
      },
    )
    const d = delivered(events)
    expect(d).toHaveLength(1)
    const paidUnits = d[0].units
    // Tender capacity is 10: nets first (4), containers (2 x 2), then bottles (2) -> 10 units.
    expect(d[0].units).toBe(10)
    expect(d[0].credits).toBe(cargoCredits(d[0].counts))
    expect(m.credits).toBe(d[0].credits)
    expect(m.cargoUsed).toBe(startUnits - 10) // the rest never left the hold
    expect(m.fleet.cargoUnits).toBe(0)
    expect(totalSystemUnits(m) + paidUnits).toBe(startUnits)
  })

  it('shows the full status sequence and returns to available near the player', () => {
    const m = fleetModel()
    const p = player()
    m.cargo = { bottle: 6, container: 0, net: 0 }
    m.requestTender(p)
    const seen: TenderStatus[] = ['toPlayer']
    run(m, p, 240, undefined, () => {
      const s = m.fleet.tenders[0].status
      if (seen[seen.length - 1] !== s) seen.push(s)
    })
    expect(seen.map((s) => TENDER_STATUS_LABEL[s])).toEqual(['Heading to you', 'Loading', 'Delivering', 'Delivering', 'Returning', 'Available'])
    const t = m.fleet.tenders[0]
    expect(t.status).toBe('idle')
    expect(Math.hypot(t.x - p.x, t.y - p.y)).toBeLessThan(BALANCE.tender.followRadius * 1.4)
    expect(m.credits).toBe(12)
  })

  it('lets the player keep collecting while the tender is away (hold can refill during delivery)', () => {
    const m = fleetModel()
    const p = player()
    m.cargo = { bottle: 10, container: 0, net: 0 }
    m.requestTender(p)
    run(m, p, 30, () => m.fleet.tenders[0].status === 'delivering')
    expect(m.fleet.tenders[0].status).toBe('delivering')
    expect(m.cargoUsed).toBe(0) // the hold is free again right away
    m.cargo = { bottle: 7, container: 0, net: 0 } // pretend the player scooped more meanwhile
    run(m, p, 120, (ev) => delivered(ev).length > 0)
    expect(m.credits).toBe(20)
    expect(m.cargoUsed).toBe(7)
  })

  it('a hold emptied before the tender arrives sends it home without pay', () => {
    const m = fleetModel()
    const p = player(4000, 700)
    m.cargo = { bottle: 5, container: 0, net: 0 }
    m.requestTender(p)
    m.cargo = emptyCargo() // player unloaded at the station meanwhile
    const ev = run(m, p, 300, () => m.fleet.tenders[0].status === 'idle' && m.fleet.tenders[0].phaseTime > 1)
    expect(ev.some((e) => e.type === 'nothingToCarry')).toBe(true)
    expect(delivered(ev)).toHaveLength(0)
    expect(m.credits).toBe(0)
    expect(m.fleet.cargoUnits).toBe(0)
  })

  it('a full tender and a full hold behave: capacity grows with the upgrade level', () => {
    const m = fleetModel(4) // capacity 25
    const p = player()
    m.upgrades = { ...m.upgrades, cargo: 5 } // hold of 45
    m.cargo = { bottle: 20, container: 10, net: 0 } // 40 units
    m.requestTender(p)
    const ev = run(m, p, 240, (e) => delivered(e).length > 0)
    expect(delivered(ev)[0].units).toBe(25)
    expect(m.cargoUsed).toBe(15)
  })

  it('records statistics for future achievements', () => {
    const m = fleetModel()
    const p = player()
    const seen: string[] = []
    m.listen((e) => seen.push(e.type))
    m.cargo = { bottle: 3, container: 0, net: 0 }
    m.requestTender(p)
    run(m, p, 200, (e) => delivered(e).length > 0)
    expect(seen).toEqual(expect.arrayContaining(['tenderDispatched', 'tenderLoaded', 'tenderDelivered']))
    expect(m.runStats).toMatchObject({ tenderDispatches: 1, tenderDeliveries: 1, tenderUnits: 3, tenderCredits: 6, creditsEarned: 6 })
  })
})

describe('multiple tenders', () => {
  it('work independently: separate cargo, positions and statuses, and no cargo is created or lost', () => {
    const m = fleetModel(2, 1)
    expect(m.fleet.count).toBe(2)
    const p = player()
    m.cargo = { bottle: 8, container: 6, net: 1 } // 8 + 12 + 4 = 24 units, 16 + 24 + 10 = 50 credits
    const start = cargoUnits(m.cargo)
    expect(m.requestTender(p).result.ok).toBe(true)
    expect(m.requestTender(p).result.ok).toBe(true)
    const [a, b] = m.fleet.tenders
    expect(a.status).toBe('toPlayer')
    expect(b.status).toBe('toPlayer')

    const ev = run(
      m,
      p,
      300,
      (e) => delivered(e).length >= 2,
      () => {
        // Each tender owns its own cargo object, and nothing is ever created or lost.
        expect(a.cargo).not.toBe(b.cargo)
        expect(m.cargoUsed + m.fleet.cargoUnits + m.runStats.tenderUnits).toBe(start)
      },
    )
    const d = delivered(ev)
    expect(d).toHaveLength(2)
    expect(new Set(d.map((x) => x.tender.id)).size).toBe(2)
    const paid = d.reduce((s, x) => s + x.units, 0)
    expect(paid + m.cargoUsed + m.fleet.cargoUnits).toBe(start)
    expect(m.credits).toBe(d.reduce((s, x) => s + x.credits, 0))
    // Capacity 15 each: 24 units can all be moved by two tenders.
    expect(m.cargoUsed).toBe(0)
    expect(m.credits).toBe(50)
  })

  it('a busy tender does not affect the other one', () => {
    const m = fleetModel(2, 1)
    const p = player()
    m.cargo = { bottle: 5, container: 0, net: 0 }
    m.requestTender(p)
    const [a, b] = m.fleet.tenders
    const first = [a, b].find((t) => t.status === 'toPlayer')!
    const other = [a, b].find((t) => t !== first)!
    expect(other.status).toBe('idle')
    run(m, p, 10, () => first.status === 'delivering')
    expect(other.cargo).toEqual(emptyCargo())
    expect(first.cargo.bottle).toBe(5)
  })
})

describe('auto dispatch', () => {
  it('level 5 sends a tender by itself once the hold is mostly full; lower levels never do', () => {
    const auto = fleetModel(5)
    const p = player()
    auto.upgrades = { ...auto.upgrades, cargo: 0 }
    auto.cargo = { bottle: 16, container: 0, net: 0 } // 80% of 20
    const ev = run(auto, p, 10, (e) => e.some((x) => x.type === 'dispatched'))
    const dispatch = ev.find((e): e is Extract<TenderEvent, { type: 'dispatched' }> => e.type === 'dispatched')
    expect(dispatch?.auto).toBe(true)

    const manual = fleetModel(4)
    manual.cargo = { bottle: 16, container: 0, net: 0 }
    const ev2 = run(manual, p, 10)
    expect(ev2.some((x) => x.type === 'dispatched')).toBe(false)
  })

  it('does not auto-dispatch below the fill threshold', () => {
    const m = fleetModel(5)
    m.cargo = { bottle: 5, container: 0, net: 0 }
    expect(run(m, player(), 10).some((e) => e.type === 'dispatched')).toBe(false)
  })
})

describe('tender navigation', () => {
  const targets = [
    [4800, 500], [5200, 1800], [3000, 700], [2400, 1800], [4300, 3100], [1500, 1000], [900, 400], [3600, 2200], [5300, 3300], [2000, 2500],
  ]

  it('finds routes from the station to far corners that stay clear of every obstacle', () => {
    const bay = nav.nearestFree(WORLD.dock.x + 40, WORLD.dock.y - 10)!
    const clearance = BALANCE.tender.radius
    for (const [x, y] of targets) {
      const goal = nav.nearestFree(x, y)!
      const path = nav.findPath(bay, goal)
      expect(path, `route to ${x},${y}`).not.toBeNull()
      let prev = bay
      for (const wp of path!) {
        const len = Math.hypot(wp.x - prev.x, wp.y - prev.y)
        const steps = Math.max(1, Math.ceil(len / 8))
        for (let i = 0; i <= steps; i++) {
          const sx = prev.x + ((wp.x - prev.x) * i) / steps
          const sy = prev.y + ((wp.y - prev.y) * i) / steps
          for (const o of obstacles) expect(Math.hypot(sx - o.x, sy - o.y)).toBeGreaterThan(o.r + clearance)
        }
        prev = wp
      }
    }
  })

  it('sails there for real: never enters an obstacle and delivers on time', () => {
    for (const [x, y] of [[4800, 500], [2400, 1800], [5200, 1800]]) {
      const m = fleetModel()
      const p = player(x, y)
      m.cargo = { bottle: 4, container: 0, net: 0 }
      m.requestTender(p)
      let worst = Infinity
      const ev = run(
        m,
        p,
        240,
        (e) => delivered(e).length > 0,
        () => {
          const t = m.fleet.tenders[0]
          for (const o of obstacles) worst = Math.min(worst, Math.hypot(t.x - o.x, t.y - o.y) - o.r)
        },
      )
      expect(delivered(ev), `delivery from ${x},${y}`).toHaveLength(1)
      expect(worst).toBeGreaterThanOrEqual(BALANCE.tender.radius - 1)
      expect(ev.some((e) => e.type === 'recovered')).toBe(false)
    }
  })

  it('level 3 sails measurably faster', () => {
    const trip = (level: number) => {
      const m = fleetModel(level)
      const p = player(4800, 500)
      m.cargo = { bottle: 4, container: 0, net: 0 }
      m.requestTender(p)
      let t = 0
      run(m, p, 300, (e) => delivered(e).length > 0, () => (t += DT))
      return t
    }
    expect(trip(3)).toBeLessThan(trip(2) * 0.9)
  })

  it('routes around the whole map without a gap (most of the water is reachable)', () => {
    expect(nav.freeRatio).toBeGreaterThan(0.55)
  })
})

describe('tender recovery and persistence', () => {
  it('a tender dropped inside an island is moved to water, keeps its cargo and still pays exactly once', () => {
    const m = fleetModel()
    const p = player()
    const t = m.fleet.tenders[0]
    const land = buildObstacles().find((o) => o.kind === 'island')!
    t.cargo = { bottle: 5, container: 0, net: 0 }
    t.status = 'delivering'
    t.x = land.x
    t.y = land.y
    const ev = run(m, p, 300, (e) => delivered(e).length > 0)
    expect(delivered(ev)).toHaveLength(1)
    expect(m.credits).toBe(10)
    run(m, p, 20)
    expect(m.credits).toBe(10) // no second payment
    expect(m.fleet.cargoUnits).toBe(0)
  })

  it('a leg that takes far too long triggers recovery without touching cargo', () => {
    const m = fleetModel()
    const p = player(4800, 500)
    const t = m.fleet.tenders[0]
    t.cargo = { bottle: 3, container: 0, net: 0 }
    t.status = 'delivering'
    t.x = 4800
    t.y = 500
    t.phaseTime = BALANCE.tender.phaseTimeout + 1
    const ev = run(m, p, 5)
    expect(ev.some((e) => e.type === 'recovered' && e.reason === 'timeout')).toBe(true)
    expect(t.cargo.bottle + delivered(ev).reduce((s, d) => s + d.counts.bottle, 0)).toBe(3)
    run(m, p, 60, (e) => delivered(e).length > 0)
    expect(m.credits).toBe(6)
  })

  function roundTrip(m: GameModel): GameModel {
    const store = new MemoryStorage()
    writeSave(store, buildSave(m, createBoat(1200, 2800, 0)))
    const loaded = loadSave(store)
    expect(loaded).not.toBeNull()
    const r = new GameModel([])
    r.restore(loaded!.model)
    return r
  }

  it('saves and restores every tender status without losing or duplicating cargo or credits', () => {
    const wanted: TenderStatus[] = ['toPlayer', 'loading', 'delivering', 'unloading', 'returning']
    for (const status of wanted) {
      const p = player()
      const m2 = fleetModel()
      m2.cargo = { bottle: 6, container: 1, net: 0 }
      m2.requestTender(p)
      run(m2, p, 300, () => m2.fleet.tenders[0].status === status)
      expect(m2.fleet.tenders[0].status).toBe(status)
      const before = totalSystemUnits(m2)
      const creditsBefore = m2.credits

      const r = roundTrip(m2)
      expect(totalSystemUnits(r)).toBe(before)
      expect(r.credits).toBe(creditsBefore)

      const ev = run(r, p, 300, (e) => delivered(e).length > 0 || r.fleet.cargoUnits === 0)
      run(r, p, 30)
      // Whatever was in transit is paid exactly once; whatever stayed in the hold is still there.
      const total = r.credits + cargoCredits(r.cargo)
      expect(total).toBe(16)
      expect(r.fleet.cargoUnits).toBe(0)
      expect(delivered(ev).length).toBeLessThanOrEqual(1)
    }
  })

  it('interrupted delivery: restoring a tender mid-trip resumes the delivery instead of discarding it', () => {
    const m = fleetModel()
    const p = player()
    m.cargo = { bottle: 8, container: 0, net: 0 }
    m.requestTender(p)
    run(m, p, 60, () => m.fleet.tenders[0].status === 'delivering')
    const r = roundTrip(m)
    expect(r.fleet.tenders[0].status).toBe('delivering')
    expect(r.fleet.tenders[0].cargo.bottle).toBe(8)
    expect(r.credits).toBe(0)
    run(r, p, 200, (e) => delivered(e).length > 0)
    expect(r.credits).toBe(16)
  })

  it('a tender that was still heading to the player restores as available, with the hold intact', () => {
    const m = fleetModel()
    const p = player(4800, 500)
    m.cargo = { bottle: 8, container: 0, net: 0 }
    m.requestTender(p)
    run(m, p, 2)
    const r = roundTrip(m)
    expect(r.cargoUsed).toBe(8)
    expect(r.fleet.tenders[0].cargo).toEqual(emptyCargo())
    expect(['returning', 'idle']).toContain(r.fleet.tenders[0].status)
  })

  it('rejects tampered tender data and implausible fleets', () => {
    const m = fleetModel(2, 1)
    const good = JSON.parse(JSON.stringify(buildSave(m, createBoat())))
    const store = (o: unknown) => {
      const s = new MemoryStorage()
      s.setItem(BALANCE.save.key, JSON.stringify(o))
      return loadSave(s)
    }
    expect(store(good)).not.toBeNull()
    const huge = JSON.parse(JSON.stringify(good))
    huge.model.tenders[0].cargo.net = 50
    expect(store(huge)).toBeNull()
    const badStatus = JSON.parse(JSON.stringify(good))
    badStatus.model.tenders[0].status = 'teleporting'
    expect(store(badStatus)).toBeNull()
    const dup = JSON.parse(JSON.stringify(good))
    dup.model.tenders[1].id = dup.model.tenders[0].id
    expect(store(dup)).toBeNull()
    const noTender = JSON.parse(JSON.stringify(good))
    noTender.model.upgrades.tender = 0
    expect(store(noTender)).toBeNull() // second tender without the tender track
    const lvl = JSON.parse(JSON.stringify(good))
    lvl.model.upgrades.engine = 9
    expect(store(lvl)).toBeNull()
  })
})
