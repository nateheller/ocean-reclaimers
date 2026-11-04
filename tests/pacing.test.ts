import { describe, expect, it } from 'vitest'
import { BALANCE } from '../src/config/balance'
import { WORLD } from '../src/config/world'
import { boostReady, createBoat, distanceToDock, inCollectionZone, inDockRange, resolveCollisions, stepBoat } from '../src/core/boat'
import { GameModel } from '../src/core/model'
import { UPGRADE_IDS } from '../src/core/stats'
import { buildObstacles, generateDebris } from '../src/core/worldgen'

/**
 * Headless pacing check: a simple greedy bot (imperfect steering) plays the pure gameplay core.
 * It is a rough guide for tuning BALANCE, not a perfect player.
 */
function simulate(skill: number, maxMinutes = 30) {
  const spawns = generateDebris()
  const obstacles = buildObstacles()
  const m = new GameModel(spawns)
  const boat = createBoat()
  const dt = 1 / 60
  let t = 0
  let target: number | null = null
  let returning = false
  let lastGain = 0
  const banned = new Set<number>()
  const events: { t: number; what: string }[] = []
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
  const pick = (): number | null => {
    let best = -1
    let bestScore = Infinity
    for (const s of spawns) {
      if (m.isRemoved(s.id) || banned.has(s.id) || !m.canCollect(s.type)) continue
      const score = Math.hypot(s.x - boat.x, s.y - boat.y) + (m.unloads === 0 ? distanceToDock(s) * 0.25 : 0)
      if (score < bestScore) { bestScore = score; best = s.id }
    }
    return best < 0 ? null : best
  }
  while (t < 60 * maxMinutes && m.progress < 0.75) {
    t += dt
    m.tick(t, dt)
    if (target !== null && t - lastGain > 25) { banned.add(target); target = null; lastGain = t }
    if (!returning && (m.cargoFree < 2 || (target === null && m.cargoUsed > 0))) returning = true
    if (returning && inDockRange(boat)) {
      m.unload()
      lastGain = t
      for (const id of UPGRADE_IDS) if (!m.upgrades[id] && m.credits >= BALANCE.upgrades[id].cost) { m.buy(id); events.push({ t, what: `buy ${id}` }) }
      returning = false
      target = null
    }
    if (!returning) {
      if (target === null || m.isRemoved(target)) target = pick()
      if (target === null) returning = true
    }
    let tx: number = WORLD.dock.x
    let ty: number = WORLD.dock.y
    if (!returning) { const s = spawns.find((q) => q.id === target)!; tx = s.x; ty = s.y }
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
        if (r.ok) lastGain = t
        if (r.ok) for (const ms of r.newMilestones) events.push({ t, what: `milestone ${ms * 100}%` })
      }
    }
  }
  return { t, events, progress: m.progress, credits: m.credits }
}

describe('pacing (greedy bot)', () => {
  it('reaches the first upgrade in a few minutes and the 75% goal in a reasonable session', () => {
    const r = simulate(0.85)
    // eslint-disable-next-line no-console
    console.log(`bot: ${(r.t / 60).toFixed(1)} min, ${(r.progress * 100).toFixed(0)}%\n` + r.events.map((e) => `${(e.t).toFixed(0)}s ${e.what}`).join('\n'))
    const firstBuy = r.events.find((e) => e.what.startsWith('buy'))
    expect(firstBuy).toBeDefined()
    expect(firstBuy!.t).toBeLessThan(240)
    expect(r.progress).toBeGreaterThanOrEqual(0.75)
    expect(r.t).toBeLessThan(60 * 20)
  }, 60000)
})
