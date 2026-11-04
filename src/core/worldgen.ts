/** Deterministic world generation: obstacles, zones and debris placement. */
import type { DebrisType } from '../config/balance'
import {
  ISLANDS,
  PATCHES,
  REEFS,
  ROCKS,
  STATION_LAND,
  STATION_JETTIES,
  WORLD,
  type PatchDef,
  type ZoneId,
} from '../config/world'
import { hashSeed, Rng } from './rng'

export interface Circle {
  readonly x: number
  readonly y: number
  readonly r: number
}

export type ObstacleKind = 'island' | 'rock' | 'reef' | 'land'

export interface Obstacle extends Circle {
  readonly kind: ObstacleKind
  readonly group: string
}

export interface DebrisSpawn {
  readonly id: number
  readonly type: DebrisType
  readonly x: number
  readonly y: number
  readonly rot: number
  readonly patch: string
  readonly zone: ZoneId
}

/** All solid circles in the world. */
export function buildObstacles(): Obstacle[] {
  const out: Obstacle[] = []
  for (const isl of ISLANDS) {
    for (const l of isl.lobes) {
      out.push({ x: isl.x + l.dx, y: isl.y + l.dy, r: l.r * 0.94, kind: 'island', group: isl.id })
    }
  }
  STATION_LAND.forEach((s, i) => out.push({ ...s, r: s.r * 0.94, kind: 'land', group: `station-${i}` }))
  STATION_JETTIES.forEach((j, n) => {
    for (let x = j.x0; x <= j.x1; x += 22) out.push({ x, y: j.y, r: 14, kind: 'land', group: `jetty-${n}` })
  })
  ROCKS.forEach((s, i) => out.push({ ...s, kind: 'rock', group: `rock-${i}` }))
  REEFS.forEach((s, i) => out.push({ ...s, kind: 'reef', group: `reef-${i}` }))
  return out
}

export function zoneAt(x: number, y: number): ZoneId {
  const d = Math.hypot(x - WORLD.dock.x, y - WORLD.dock.y)
  if (d < WORLD.harborRadius) return 'harbor'
  if (d < WORLD.shallowsRadius) return 'shallows'
  return 'open'
}

const MIN_SPACING = 30
const OBSTACLE_MARGIN = 34

function scatterPatch(
  patch: PatchDef,
  patchIndex: number,
  obstacles: readonly Obstacle[],
  seed: number,
  placed: { x: number; y: number }[],
): Omit<DebrisSpawn, 'id'>[] {
  // Each patch has its own stream so editing one patch never shifts the others.
  const rng = new Rng(hashSeed(seed, 'patch', patch.id, patchIndex))
  const types: DebrisType[] = []
  // Nets are placed first so they claim open spots, then containers, then bottles.
  for (let i = 0; i < patch.counts.net; i++) types.push('net')
  for (let i = 0; i < patch.counts.container; i++) types.push('container')
  for (let i = 0; i < patch.counts.bottle; i++) types.push('bottle')

  const result: Omit<DebrisSpawn, 'id'>[] = []
  const margin = (r: number) => OBSTACLE_MARGIN + r
  for (const type of types) {
    let spread = patch.radius
    let pos: { x: number; y: number } | null = null
    for (let attempt = 0; attempt < 400 && !pos; attempt++) {
      if (attempt > 0 && attempt % 40 === 0) spread *= 1.15
      const a = rng.range(0, Math.PI * 2)
      const d = spread * Math.sqrt(rng.next())
      const x = patch.x + Math.cos(a) * d
      const y = patch.y + Math.sin(a) * d
      if (x < 160 || y < 160 || x > WORLD.width - 160 || y > WORLD.height - 160) continue
      if (obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < margin(o.r))) continue
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < MIN_SPACING)) continue
      pos = { x, y }
    }
    if (!pos) continue
    placed.push(pos)
    result.push({
      type,
      x: Math.round(pos.x * 10) / 10,
      y: Math.round(pos.y * 10) / 10,
      rot: Math.round(rng.range(0, Math.PI * 2) * 1000) / 1000,
      patch: patch.id,
      zone: zoneAt(pos.x, pos.y),
    })
  }
  return result
}

/** Generate every piece of starting debris. Same seed -> identical output. */
export function generateDebris(
  seed: number = WORLD.seed,
  patches: readonly PatchDef[] = PATCHES,
  obstacles: readonly Obstacle[] = buildObstacles(),
): DebrisSpawn[] {
  const placed: { x: number; y: number }[] = []
  const out: DebrisSpawn[] = []
  patches.forEach((patch, i) => {
    for (const item of scatterPatch(patch, i, obstacles, seed, placed)) {
      out.push({ ...item, id: out.length })
    }
  })
  return out
}

export interface PalmSpot {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly rot: number
}

/** Seeded palm tree positions for an island (placed on its lobes). */
export function islandPalms(islandId: string, seed: number = WORLD.seed): PalmSpot[] {
  const isl = ISLANDS.find((i) => i.id === islandId)
  if (!isl) return []
  const rng = new Rng(hashSeed(seed, 'palms', islandId))
  const spots: PalmSpot[] = []
  for (let i = 0; i < isl.palms; i++) {
    const lobe = isl.lobes[i % isl.lobes.length]
    const a = rng.range(0, Math.PI * 2)
    const d = lobe.r * 0.55 * Math.sqrt(rng.next())
    spots.push({
      x: isl.x + lobe.dx + Math.cos(a) * d,
      y: isl.y + lobe.dy + Math.sin(a) * d,
      scale: rng.range(0.8, 1.2),
      rot: rng.range(0, Math.PI * 2),
    })
  }
  return spots
}

export function totalCargoUnits(spawns: readonly DebrisSpawn[], units: Record<DebrisType, number>): number {
  return spawns.reduce((sum, s) => sum + units[s.type], 0)
}
