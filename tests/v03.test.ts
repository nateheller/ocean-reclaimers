import { describe, expect, it } from 'vitest'
import { BALANCE } from '../src/config/balance'
import { WORLD } from '../src/config/world'
import { DebrisField } from '../src/core/debrisField'
import {
  alreadySubmitted,
  loadScores,
  markSubmitted,
  normalizeName,
  personalBest,
  rankFor,
  submitScore,
  topScores,
} from '../src/core/leaderboard'
import { GameModel } from '../src/core/model'
import { edgeIndicator, worldToScreen, type Insets } from '../src/core/navigation'
import { buildSave, loadSave, MemoryStorage, parseSave, writeSave, type StorageLike } from '../src/core/save'
import { finalScore, formatTime, makeCompletion, roundTime, timeBandLabel, timeMultiplier } from '../src/core/scoring'
import {
  assistProfile,
  assistStage,
  distanceLabel,
  mergeProfiles,
  NO_SENSORS,
  readSensors,
  sensorProfile,
  sonarProfile,
} from '../src/core/sensors'
import { generateDebris, type DebrisSpawn } from '../src/core/worldgen'

const spawn = (id: number, type: DebrisSpawn['type'], x = 100 + id * 40, y = 100, patch = 't'): DebrisSpawn => ({
  id, type, x, y, rot: 0, patch, zone: 'harbor',
})

// ---------------------------------------------------------------------------------------------------------------
describe('completion scoring', () => {
  it('uses the configured time bands with exclusive upper bounds', () => {
    expect(timeMultiplier(0)).toBe(1.5)
    expect(timeMultiplier(239.99)).toBe(1.5)
    expect(timeMultiplier(240)).toBe(1.35)
    expect(timeMultiplier(299.99)).toBe(1.35)
    expect(timeMultiplier(300)).toBe(1.2)
    expect(timeMultiplier(359.99)).toBe(1.2)
    expect(timeMultiplier(360)).toBe(1.1)
    expect(timeMultiplier(479.99)).toBe(1.1)
    expect(timeMultiplier(480)).toBe(1.0)
    expect(timeMultiplier(5000)).toBe(1.0)
  })

  it('never lets the multiplier drop below 1 and rounds the final score to a whole number', () => {
    for (const t of [0, 100, 250, 400, 700, 99999]) expect(timeMultiplier(t)).toBeGreaterThanOrEqual(1)
    expect(finalScore(1001, 1.35)).toBe(1351)
    expect(finalScore(1234, 1)).toBe(1234)
    expect(finalScore(-50, 1.5)).toBe(0)
    expect(Number.isInteger(finalScore(777, 1.2))).toBe(true)
  })

  it('rounds the clock to hundredths and formats it as m:ss', () => {
    expect(roundTime(12.3456)).toBe(12.35)
    expect(roundTime(-4)).toBe(0)
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65.9)).toBe('1:05')
    expect(formatTime(600)).toBe('10:00')
  })

  it('describes the band a time falls in', () => {
    expect(timeBandLabel(100)).toBe('Under 4:00')
    expect(timeBandLabel(250)).toBe('4:00-5:00')
    expect(timeBandLabel(481)).toBe('Over 8:00')
  })

  it('builds a pending completion with the bonus applied once', () => {
    const c = makeCompletion('run-1', 245.678, 1000, 7)
    expect(c.timeSeconds).toBe(245.68)
    expect(c.multiplier).toBe(1.35)
    expect(c.finalScore).toBe(1350)
    expect(c.entry).toBe('pending')
  })

  it('captures the completion exactly once, at the moment 75% is reached, and keeps it afterwards', () => {
    const spawns = [spawn(0, 'bottle'), spawn(1, 'bottle'), spawn(2, 'bottle'), spawn(3, 'bottle')]
    const m = new GameModel(spawns)
    m.tick(0, 10)
    m.collect(0, 0)
    m.collect(1, 0.1)
    expect(m.completion).toBeNull()
    m.collect(2, 0.2)
    expect(m.progress).toBeCloseTo(0.75)
    expect(m.completion).not.toBeNull()
    const first = { ...m.completion! }
    expect(first.timeSeconds).toBe(10)
    expect(first.baseScore).toBe(m.score)
    m.tick(1, 500)
    m.collect(3, 1)
    expect(m.completion).toEqual(first)
  })

  it('counts docked time on the run clock and excludes nothing the caller does not skip', () => {
    const m = new GameModel([spawn(0, 'bottle')])
    m.tick(0, 5)
    m.advanceClock(7)
    expect(m.playSeconds).toBe(12)
  })

  it('does not apply the combo multiplier to credits or cargo', () => {
    const spawns = Array.from({ length: 12 }, (_, i) => spawn(i, 'bottle'))
    const m = new GameModel(spawns)
    for (let i = 0; i < 10; i++) m.collect(i, i * 0.1)
    expect(m.cargoUsed).toBe(10)
    expect(m.unload().credits).toBe(10 * BALANCE.debris.bottle.credits)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('local leaderboard', () => {
  const completion = (id: string, score: number, time = 300) => ({
    ...makeCompletion(id, time, score, 3),
    baseScore: score,
    multiplier: 1,
    finalScore: score,
  })

  it('orders by score, keeps the top 10 and ranks a tie below the existing score', () => {
    const store = new MemoryStorage()
    for (let i = 0; i < 12; i++) {
      submitScore(store, { completion: completion(`r${i}`, 1000 + i * 100), name: `P${i}`, now: new Date(2026, 0, 1, 0, 0, i) })
    }
    const top = topScores(loadScores(store))
    expect(top).toHaveLength(BALANCE.scoring.leaderboardSize)
    expect(top[0].finalScore).toBe(2100)
    expect(top[9].finalScore).toBe(1200)
    for (let i = 1; i < top.length; i++) expect(top[i - 1].finalScore).toBeGreaterThanOrEqual(top[i].finalScore)
    expect(rankFor(loadScores(store), 1200)).toEqual({ rank: 11, qualifies: false })
    expect(rankFor(loadScores(store), 1201)).toEqual({ rank: 10, qualifies: true })
  })

  it('rejects a score that does not make a full table and leaves the table unchanged', () => {
    const store = new MemoryStorage()
    for (let i = 0; i < 10; i++) submitScore(store, { completion: completion(`r${i}`, 5000 + i), name: `P${i}` })
    const before = store.getItem(BALANCE.save.scoresKey)
    const res = submitScore(store, { completion: completion('low', 100), name: 'LOW' })
    expect(res).toEqual({ ok: false, reason: 'not-qualified' })
    expect(store.getItem(BALANCE.save.scoresKey)).toBe(before)
  })

  it('records one expedition only once, even when submitted again', () => {
    const store = new MemoryStorage()
    const c = completion('same-run', 3000)
    expect(submitScore(store, { completion: c, name: 'Ann' }).ok).toBe(true)
    expect(submitScore(store, { completion: c, name: 'Ann' })).toEqual({ ok: false, reason: 'duplicate' })
    expect(submitScore(store, { completion: c, name: 'Bob' })).toEqual({ ok: false, reason: 'duplicate' })
    expect(topScores(loadScores(store))).toHaveLength(1)
    expect(alreadySubmitted(loadScores(store), 'same-run')).toBe(true)
  })

  it('remembers runs that were evaluated but did not qualify', () => {
    const store = new MemoryStorage()
    markSubmitted(store, 'skipped-run')
    expect(alreadySubmitted(loadScores(store), 'skipped-run')).toBe(true)
    expect(submitScore(store, { completion: completion('skipped-run', 9999), name: 'X' })).toEqual({ ok: false, reason: 'duplicate' })
  })

  it('cleans names: trims, collapses spaces, upper-cases, strips unsafe characters and limits the length', () => {
    expect(normalizeName('  reef   rider ')).toBe('REEF RIDER')
    expect(normalizeName('<b>Ann</b>')).toBe('BANNB')
    expect(normalizeName('')).toBe(BALANCE.scoring.defaultName)
    expect(normalizeName('   ')).toBe(BALANCE.scoring.defaultName)
    expect(normalizeName('a'.repeat(40))).toHaveLength(BALANCE.scoring.nameMaxLength)
    expect(normalizeName('Zo\u00eb-Mar\u00eda')).toBe('ZO\u00cb-MAR\u00cdA')
  })

  it('tracks a personal best per name, case-insensitively, and reports the improvement', () => {
    const store = new MemoryStorage()
    const a = submitScore(store, { completion: completion('a', 2000), name: 'Ann' })
    expect(a.ok && a.newPersonalBest).toBe(false)
    const b = submitScore(store, { completion: completion('b', 2600), name: ' ann ' })
    expect(b.ok && b.newPersonalBest).toBe(true)
    expect(b.ok && b.improvement).toBe(600)
    const c = submitScore(store, { completion: completion('c', 2100), name: 'ANN' })
    expect(c.ok && c.newPersonalBest).toBe(false)
    expect(personalBest(loadScores(store), 'Ann')?.finalScore).toBe(2600)
  })

  it('survives corrupt or hostile stored data', () => {
    const store = new MemoryStorage()
    for (const junk of ['not json', '{"version":1,"boards":5}', 'null', '[]', '{"boards":{"coral-bay:standard":[{"x":1},null,"s"]}}']) {
      store.setItem(BALANCE.save.scoresKey, junk)
      expect(topScores(loadScores(store))).toEqual([])
      expect(submitScore(store, { completion: completion(`ok-${junk.length}`, 10), name: 'Z' }).ok).toBe(true)
    }
  })

  it('reports a storage failure instead of pretending the score was saved', () => {
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    }
    expect(submitScore(broken, { completion: completion('q', 500), name: 'Q' })).toEqual({ ok: false, reason: 'storage' })
  })

  it('keeps regions/modes on separate boards', () => {
    const store = new MemoryStorage()
    submitScore(store, { completion: completion('s1', 100), name: 'A' })
    submitScore(store, { completion: completion('s2', 999), name: 'B', board: { region: 'other', mode: 'standard' } })
    expect(topScores(loadScores(store))).toHaveLength(1)
    expect(topScores(loadScores(store), { region: 'other', mode: 'standard' })).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('screen-edge navigation', () => {
  const view = { x: 1000, y: 1000, width: 1000, height: 600 }
  const screen = { width: 1000, height: 600 }
  const insets: Insets = { top: 100, right: 50, bottom: 150, left: 50 }
  const opts = { clearMargin: 60, hysteresis: 40, insets }

  it('maps world points to the screen', () => {
    expect(worldToScreen({ x: 1500, y: 1300 }, view, screen)).toEqual({ x: 500, y: 300 })
  })

  it('shows no arrow for a target that is clearly on screen', () => {
    expect(edgeIndicator({ x: 1500, y: 1300 }, view, screen, opts).show).toBe(false)
  })

  it('points toward targets in each direction and keeps the arrow inside the safe area', () => {
    const cases: Array<[number, number, number]> = [
      [3000, 1300, 0], // east
      [1500, 5000, Math.PI / 2], // south
      [-2000, 1300, Math.PI], // west
      [1500, -4000, -Math.PI / 2], // north
    ]
    for (const [x, y, angle] of cases) {
      const ind = edgeIndicator({ x, y }, view, screen, opts)
      expect(ind.show).toBe(true)
      expect(Math.abs(Math.atan2(Math.sin(ind.angle - angle), Math.cos(ind.angle - angle)))).toBeLessThan(0.05)
      expect(ind.x).toBeGreaterThanOrEqual(insets.left - 0.001)
      expect(ind.x).toBeLessThanOrEqual(screen.width - insets.right + 0.001)
      expect(ind.y).toBeGreaterThanOrEqual(insets.top - 0.001)
      expect(ind.y).toBeLessThanOrEqual(screen.height - insets.bottom + 0.001)
    }
  })

  it('behaves the same at every distance (no cut-off) and at other resolutions', () => {
    for (const d of [800, 5000, 50000]) expect(edgeIndicator({ x: 1500 + d, y: 1300 }, view, screen, opts).show).toBe(true)
    const big = { width: 1920, height: 1080 }
    const bigView = { x: 1000, y: 1000, width: 1920, height: 1080 }
    const bigInsets: Insets = { top: 100, right: 56, bottom: 150, left: 56 }
    const ind = edgeIndicator({ x: 9000, y: 1500 }, bigView, big, { ...opts, insets: bigInsets })
    expect(ind.show).toBe(true)
    expect(ind.x).toBeLessThanOrEqual(big.width - 56 + 0.001)
  })

  it('uses hysteresis: a shown arrow hides only once the target is comfortably inside', () => {
    const edgeTarget = { x: 1000 + 40, y: 1300 } // 40 px inside the left edge (< clearMargin 60)
    expect(edgeIndicator(edgeTarget, view, screen, { ...opts, wasShown: false }).show).toBe(true)
    const nearlyClear = { x: 1000 + 80, y: 1300 } // inside the clear area, but within the hysteresis band
    expect(edgeIndicator(nearlyClear, view, screen, { ...opts, wasShown: false }).show).toBe(false)
    expect(edgeIndicator(nearlyClear, view, screen, { ...opts, wasShown: true }).show).toBe(true)
    const wellInside = { x: 1000 + 160, y: 1300 }
    expect(edgeIndicator(wellInside, view, screen, { ...opts, wasShown: true }).show).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('debris field', () => {
  const spawns = [spawn(0, 'bottle', 100, 100, 'a'), spawn(1, 'net', 140, 100, 'a'), spawn(2, 'container', 2000, 2000, 'b')]

  it('tracks what is left and updates concentrations the moment something is removed', () => {
    const f = new DebrisField(spawns)
    expect(f.count).toBe(3)
    expect(f.units).toBe(1 + 4 + 2)
    expect(f.concentrations().map((c) => c.patch).sort()).toEqual(['a', 'b'])
    expect(f.remove(2)).toBe(true)
    expect(f.remove(2)).toBe(false)
    expect(f.concentrations().map((c) => c.patch)).toEqual(['a'])
    expect(f.units).toBe(5)
    expect(f.remove(0) && f.remove(1)).toBe(true)
    expect(f.concentrations()).toEqual([])
  })

  it('finds the nearest item deterministically, honouring filters and range', () => {
    const f = new DebrisField(spawns)
    expect(f.nearest(110, 100)?.id).toBe(0)
    expect(f.nearest(110, 100, { accept: (s) => s.id !== 0 })?.id).toBe(1)
    expect(f.nearest(110, 100, { maxDist: 5 })).toBeNull()
    expect(f.nearest(1900, 1900)?.id).toBe(2)
  })

  it('restores exactly the removed set', () => {
    const f = new DebrisField(spawns)
    f.restore([0, 2])
    expect(f.all().map((s) => s.id)).toEqual([1])
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('sonar and late-game assistance', () => {
  it('has no sensors without sonar early in the game', () => {
    expect(sensorProfile(0, 0.1)).toBe(NO_SENSORS)
    expect(readSensors(new DebrisField(generateDebris()), NO_SENSORS, { x: 500, y: 3000 })).toEqual({ arrows: [], minimap: [] })
  })

  it('gets steadily stronger with each sonar level', () => {
    const profiles = [1, 2, 3, 4, 5].map(sonarProfile)
    for (let i = 1; i < profiles.length; i++) {
      expect(profiles[i].arrows).toBeGreaterThanOrEqual(profiles[i - 1].arrows)
      expect(profiles[i].arrowRange).toBeGreaterThanOrEqual(profiles[i - 1].arrowRange)
      expect(profiles[i].precision).toBeGreaterThan(profiles[i - 1].precision)
    }
    expect(profiles[4].minimapItems).toBe(true)
    expect(profiles[0].minimapRange).toBe(0)
  })

  it('stages the free assistance by progress, without needing sonar', () => {
    expect(assistStage(0.3)).toBe(0)
    expect(assistStage(BALANCE.assist.hintAt)).toBe(1)
    expect(assistStage(BALANCE.assist.guidanceAt)).toBe(2)
    expect(assistStage(BALANCE.assist.isolatedAt)).toBe(3)
    expect(assistProfile(0)).toBe(NO_SENSORS)
    expect(assistProfile(1).subtle).toBe(true)
    expect(assistProfile(3).minimapItems).toBe(true)
  })

  it('merges to the best of both sources and never removes sonar capability', () => {
    const sonar = sonarProfile(4)
    const merged = sensorProfile(4, 0.9)
    expect(merged.arrows).toBeGreaterThanOrEqual(sonar.arrows)
    expect(merged.arrowRange).toBeGreaterThanOrEqual(sonar.arrowRange)
    expect(merged.precision).toBeGreaterThanOrEqual(sonar.precision)
    expect(mergeProfiles(sonar, NO_SENSORS)).toBe(sonar)
  })

  it('only ever marks debris that is still in the water, nearest first, within the arrow budget', () => {
    const all = generateDebris()
    const f = new DebrisField(all)
    const boat = { x: 700, y: 3000 }
    const profile = sonarProfile(3)
    const before = readSensors(f, profile, boat)
    expect(before.arrows.length).toBeGreaterThan(0)
    expect(before.arrows.length).toBeLessThanOrEqual(profile.arrows)
    for (let i = 1; i < before.arrows.length; i++) expect(before.arrows[i].distance).toBeGreaterThanOrEqual(before.arrows[i - 1].distance)
    // Clear the nearest patch completely (as a trawler or the player would): its marker must disappear at once.
    const target = before.arrows[0]
    for (const s of f.all()) if (s.patch === target.key) f.remove(s.id)
    const after = readSensors(f, profile, boat)
    expect(after.arrows.some((m) => m.key === target.key)).toBe(false)
    expect(after.minimap.some((m) => m.key === target.key)).toBe(false)
  })

  it('precision scanner lists every remaining item, and nothing that was collected', () => {
    const all = generateDebris()
    const f = new DebrisField(all)
    for (const s of all.slice(0, all.length - 5)) f.remove(s.id)
    const reading = readSensors(f, sonarProfile(5), { x: 3000, y: 2000 })
    const items = reading.minimap.filter((m) => m.kind === 'item')
    expect(items.map((m) => m.key).sort()).toEqual(f.all().map((s) => `i${s.id}`).sort())
  })

  it('guarantees a way to find the last debris near the end with no sonar at all', () => {
    const all = generateDebris()
    const f = new DebrisField(all)
    // Leave the final 3% of items scattered across the map.
    const keep = new Set(all.filter((_, i) => i % Math.ceil(all.length / 8) === 0).map((s) => s.id))
    for (const s of all) if (!keep.has(s.id)) f.remove(s.id)
    const profile = sensorProfile(0, 0.72)
    expect(profile.source).toBe('assist')
    const reading = readSensors(f, profile, { x: 400, y: 400 })
    expect(reading.arrows.length).toBeGreaterThan(0)
    expect(reading.minimap.filter((m) => m.kind === 'item')).toHaveLength(f.count)
    // Arrows point at real remaining concentrations.
    const live = new Set(f.concentrations().map((c) => c.patch))
    for (const a of reading.arrows) expect(live.has(a.key)).toBe(true)
  })

  it('rounds distance readouts according to precision', () => {
    expect(distanceLabel(1234, 1)).toBe('120 m')
    expect(distanceLabel(1234, 0.6)).toBe('~100 m')
    expect(distanceLabel(1234, 0.2)).toBe('~100 m')
    expect(distanceLabel(4800, 0.6)).toBe('~500 m')
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('save format v3', () => {
  const boat = { x: 800, y: 2900, heading: 1.1 }

  it('round-trips trawlers, the run id, stats and a pending completion', () => {
    const m = new GameModel(generateDebris())
    m.credits = 10_000
    for (const id of ['trawler', 'trawler', 'trawlerFleet', 'sonar', 'sonar'] as const) expect(m.buy(id).ok).toBe(true)
    m.tick(0, 123.456)
    for (const s of m.field.all()) {
      if (m.progress >= BALANCE.progress.completion) break
      if (!m.collect(s.id, 0).ok) {
        m.unload()
        m.collect(s.id, 0)
      }
    }
    expect(m.completion).not.toBeNull()
    const storage = new MemoryStorage()
    expect(writeSave(storage, buildSave(m, boat))).toBe(true)
    const loaded = loadSave(storage)!
    expect(loaded.version).toBe(3)
    expect(loaded.model.runId).toBe(m.runId)
    expect(loaded.model.completion).toEqual(m.completion)
    expect(loaded.model.upgrades.sonar).toBe(2)
    expect(loaded.model.trawlers).toHaveLength(2)
    expect(loaded.model.playSeconds).toBe(roundTime(123.456))

    const restored = new GameModel(generateDebris())
    restored.restore(loaded.model)
    expect(restored.runId).toBe(m.runId)
    expect(restored.completion).toEqual(m.completion)
    expect(restored.trawlers.count).toBe(2)
    expect(restored.progress).toBeCloseTo(m.progress, 10)
    expect(restored.field.count).toBe(m.field.count)
  })

  it('migrates a version 1 save (three boolean upgrades) without a completion record', () => {
    const v1 = {
      version: 1,
      seed: WORLD.seed,
      savedAt: 1,
      model: { credits: 120, score: 340, cargo: { bottle: 2, container: 0, net: 0 }, upgrades: { cargo: true, engine: false, width: true }, removed: [0, 1, 2], milestones: [], unloads: 2, bestChain: 4, playSeconds: 200, completed: false },
      boat,
    }
    const parsed = parseSave(JSON.stringify(v1))!
    expect(parsed).not.toBeNull()
    expect(parsed.model.upgrades.cargo).toBeGreaterThan(0)
    expect(parsed.model.upgrades.engine).toBe(0)
    expect(parsed.model.upgrades.sonar).toBe(0)
    expect(parsed.model.trawlers).toEqual([])
    expect(parsed.model.completion).toBeNull()
    expect(parsed.model.runId.length).toBeGreaterThan(0)
  })

  it('migrates a version 2 save (tenders, no trawlers) and never offers an old finished run to the leaderboard', () => {
    const m = new GameModel(generateDebris())
    const v3 = JSON.parse(JSON.stringify(buildSave(m, boat)))
    v3.version = 2
    delete v3.model.trawlers
    delete v3.model.runId
    delete v3.model.completion
    v3.model.completed = true
    const parsed = parseSave(JSON.stringify(v3))!
    expect(parsed).not.toBeNull()
    expect(parsed.model.trawlers).toEqual([])
    expect(parsed.model.completion).toBeNull()
    expect(parsed.model.completed).toBe(true)
  })

  it('rejects tampered or impossible data', () => {
    const base = JSON.parse(JSON.stringify(buildSave(new GameModel(generateDebris()), boat)))
    const bad = (mut: (d: typeof base) => void) => {
      const d = JSON.parse(JSON.stringify(base))
      mut(d)
      return parseSave(JSON.stringify(d))
    }
    expect(bad((d) => { d.seed = 1 })).toBeNull()
    expect(bad((d) => { d.version = 99 })).toBeNull()
    expect(bad((d) => { d.model.credits = -5 })).toBeNull()
    expect(bad((d) => { d.model.upgrades.trawlerFleet = 1 })).toBeNull() // second trawler without a trawler
    expect(bad((d) => { d.model.upgrades.sonar = 99 })).toBeNull()
    expect(bad((d) => { d.model.cargo = { bottle: 500, container: 0, net: 0 } })).toBeNull()
    expect(parseSave('{"version":3')).toBeNull()
    expect(parseSave(null)).toBeNull()
  })

  it('drops a corrupt completion record rather than trusting it', () => {
    const m = new GameModel(generateDebris())
    const d = JSON.parse(JSON.stringify(buildSave(m, boat)))
    d.model.completion = { runId: 'x', timeSeconds: 10, baseScore: 5, finalScore: 5, multiplier: 0.2, bestChain: 1, entry: 'pending' }
    const parsed = parseSave(JSON.stringify(d))
    expect(parsed === null || parsed.model.completion === null).toBe(true)
  })
})
