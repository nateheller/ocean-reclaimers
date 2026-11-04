import { describe, expect, it } from 'vitest'
import { BALANCE, type UpgradeId } from '../src/config/balance'
import { WORLD } from '../src/config/world'
import { boostReady, createBoat, distanceToDock, inCollectionZone, inDockRange, resolveCollisions, stepBoat } from '../src/core/boat'
import { GameModel } from '../src/core/model'
import { worldNav } from '../src/core/navmap'
import { UPGRADES } from '../src/core/upgrades'
import { buildObstacles, generateDebris } from '../src/core/worldgen'

/**
 * Headless pacing check: a simple greedy bot (imperfect steering) plays the pure gameplay core, buys upgrades the way
 * a casual player would (cheapest affordable, tender first) and calls cargo tenders when its hold fills up far from
 * the station. It is a rough guide for tuning BALANCE, not a perfect player.
 */
interface Purchase {
  t: number
  progress: number
  id: UpgradeId
  level: number
  cost: number
}

export function simulate(skill: number, useTenders: boolean, maxMinutes = 30, trace?: (line: string) => void) {
  const spawns = generateDebris()
  const obstacles = buildObstacles()
  const m = new GameModel(spawns)
  const boat = createBoat()
  const dt = 1 / 60
  let t = 0
  let target: number | null = null
  let returning = false
  let lastGain = 0
  let tenderTrips = 0
  let stationTrips = 0
  const banned = new Set<number>()
  const buys: Purchase[] = []
  const milestones: { t: number; at: number }[] = []
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
  const pick = (): number | null => {
    let best = -1
    let bestScore = Infinity
    for (const s of spawns) {
      if (m.isRemoved(s.id) || banned.has(s.id) || !m.canCollect(s.type)) continue
      const score = Math.hypot(s.x - boat.x, s.y - boat.y) + (m.unloads === 0 ? distanceToDock(s) * 0.25 : 0)
      if (score < bestScore) {
        bestScore = score
        best = s.id
      }
    }
    return best < 0 ? null : best
  }
  const shop = () => {
    for (;;) {
      const options = (['tender', 'fleet', 'cargo', 'engine', 'width'] as UpgradeId[])
        .map((id) => ({ id, check: m.canBuy(id) }))
        .filter((o) => o.check.ok)
      if (options.length === 0) return
      // Fleet logistics first when affordable, otherwise the cheapest improvement.
      options.sort((a, b) => (a.id === 'tender' ? -1 : b.id === 'tender' ? 1 : a.check.cost - b.check.cost))
      const pickd = options[0]
      const r = m.buy(pickd.id)
      if (!r.ok) return
      buys.push({ t, progress: m.progress, id: pickd.id, level: r.level, cost: r.cost })
    }
  }
  let nextTrace = 0
  const nav = worldNav()
  let route: { x: number; y: number }[] = []
  let routeTimer = 0
  let routeKey = ''
  while (t < 60 * maxMinutes && m.progress < 0.75) {
    t += dt
    if (trace && t >= nextTrace) {
      nextTrace += 30
      trace(`${t.toFixed(0)}s prog ${(m.progress * 100).toFixed(1)}% boat ${Math.round(boat.x)},${Math.round(boat.y)} ret ${returning} tgt ${target} hold ${m.cargoUsed}/${m.capacity} cr ${m.credits} tenders ${m.fleet.tenders.map((x) => x.status + ':' + Math.round(x.x) + ',' + Math.round(x.y)).join(' ')}`)
    }
    m.tick(t, dt)
    if (useTenders) {
      const ev = m.updateFleet(dt, boat)
      if (ev.some((e) => e.type === 'delivered')) tenderTrips += 1
    }
    if (target !== null && t - lastGain > 25) {
      banned.add(target)
      target = null
      lastGain = t
    }
    // A full-ish hold far from home: hand it to a tender if one is free, otherwise sail back.
    if (useTenders && m.cargoUsed / m.capacity >= 0.6 && distanceToDock(boat) > 500 && m.fleet.tenders.some((x) => x.status === 'idle')) {
      m.requestTender(boat)
    }
    if (!returning && (m.cargoFree < 2 || (target === null && m.cargoUsed > 0))) returning = true
    if (returning && inDockRange(boat)) {
      if (m.cargoUsed > 0) stationTrips += 1
      m.unload()
      lastGain = t
      shop()
      returning = false
      target = null
    }
    if (!returning) {
      if (target === null || m.isRemoved(target)) target = pick()
      if (target === null) returning = true
    }
    let tx: number = WORLD.dock.x
    let ty: number = WORLD.dock.y
    if (!returning) {
      const s = spawns.find((q) => q.id === target)!
      tx = s.x
      ty = s.y
    }
    // Follow a navigation route around islands (a human steers around them), straight in for the last stretch.
    routeTimer -= dt
    const key = `${returning}:${target}`
    if (routeTimer <= 0 || key !== routeKey) {
      routeTimer = 1.2
      routeKey = key
      const here = { x: boat.x, y: boat.y }
      route = nav.lineClear(here, { x: tx, y: ty }) ? [] : (nav.findPath(nav.nearestFree(here.x, here.y) ?? here, nav.nearestFree(tx, ty) ?? { x: tx, y: ty }) ?? [])
    }
    while (route.length && Math.hypot(route[0].x - boat.x, route[0].y - boat.y) < 90) route.shift()
    if (route.length) {
      tx = route[0].x
      ty = route[0].y
    }
    const diff = wrap(Math.atan2(ty - boat.y, tx - boat.x) - boat.heading)
    const noise = (Math.sin(t * 3.1) + Math.sin(t * 1.7)) * (1 - skill) * 0.5
    const steer = Math.max(-1, Math.min(1, (diff + noise) * 3))
    const dist = Math.hypot(tx - boat.x, ty - boat.y)
    const throttle = Math.abs(diff) > 1.4 && dist < 200 ? 0.2 : 1
    const boost = boostReady(boat) && Math.abs(diff) < 0.2 && dist > 500
    stepBoat(boat, { throttle, steer, boost }, m.stats, dt)
    resolveCollisions(boat, obstacles)
    for (const s of spawns) {
      if (m.isRemoved(s.id)) continue
      if (Math.abs(s.x - boat.x) > 200 || Math.abs(s.y - boat.y) > 200) continue
      if (inCollectionZone(boat, s.x, s.y, BALANCE.debris[s.type].radius, m.stats)) {
        const r = m.collect(s.id, t)
        if (r.ok) {
          lastGain = t
          for (const ms of r.newMilestones) milestones.push({ t, at: ms })
        }
      }
    }
  }
  // Spend what is left, as a player would on their final visit.
  return { t, buys, milestones, progress: m.progress, credits: m.credits, tenderTrips, stationTrips, model: m }
}

function report(label: string, r: ReturnType<typeof simulate>): string {
  const lines = r.buys.map(
    (b) => `  ${(b.progress * 100).toFixed(0).padStart(3)}%  ${(b.t / 60).toFixed(1).padStart(5)} min  ${UPGRADES[b.id].name} L${b.level}  (${b.cost})`,
  )
  return `${label}: ${(r.t / 60).toFixed(1)} min to ${(r.progress * 100).toFixed(0)}%, ${r.buys.length} purchases, ${r.tenderTrips} tender deliveries, ${r.stationTrips} station trips, credits left ${r.credits}\n${lines.join('\n')}`
}

describe('pacing (greedy bot)', () => {
  const withTenders = simulate(0.85, true)
  const without = simulate(0.85, false)
  // eslint-disable-next-line no-console
  console.log(report('with tenders', withTenders) + '\n' + report('boat only', without))

  it('reaches the first upgrade within a few minutes and finishes the expedition in a reasonable session', () => {
    expect(withTenders.buys.length).toBeGreaterThan(0)
    expect(withTenders.buys[0].t).toBeLessThan(240)
    expect(withTenders.progress).toBeGreaterThanOrEqual(0.75)
    expect(withTenders.t).toBeLessThan(60 * 20)
  }, 120_000)

  it('spreads purchases across the expedition instead of finishing the shop early', () => {
    const early = withTenders.buys.filter((b) => b.progress < 0.15).length
    const late = withTenders.buys.filter((b) => b.progress >= 0.5).length
    const total = withTenders.buys.length
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(total * 0.6) // boat upgrades alone must not exhaust the shop by 15%
    expect(late).toBeGreaterThan(0) // something meaningful is still on offer after half the bay is clean
  })

  it('makes the cargo tender attainable in the middle of the first quarter of the expedition', () => {
    const tender = withTenders.buys.find((b) => b.id === 'tender' && b.level === 1)
    expect(tender).toBeDefined()
    expect(tender!.progress).toBeGreaterThan(0.1)
    expect(tender!.progress).toBeLessThan(0.3)
  })

  it('lets tenders genuinely cut down on station trips', () => {
    expect(withTenders.tenderTrips).toBeGreaterThan(3)
    expect(withTenders.stationTrips).toBeLessThan(without.stationTrips)
  })
})
