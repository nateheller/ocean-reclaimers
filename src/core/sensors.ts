/**
 * Debris detection: purchased Ocean Sonar plus the free late-game assistance, as one pure module.
 *
 * Both sources are expressed as a `SensorProfile` (what the player is shown). The profiles are merged by taking the
 * best of each capability, so assistance never *removes* anything sonar already gives, and sonar is never required to
 * finish Coral Bay. The markers always come from the live `DebrisField`, so they can never describe debris that has
 * already been collected - by the player or by a trawler.
 */
import { BALANCE } from '../config/balance'
import type { Concentration, DebrisField } from './debrisField'
import type { Point } from './navigation'

export type SensorSource = 'none' | 'sonar' | 'assist'

export interface SensorProfile {
  /** Where the capability comes from (the stronger source wins for display styling). */
  readonly source: SensorSource
  /** Maximum number of edge-of-screen arrows. */
  readonly arrows: number
  /** Arrows only point at debris within this range of the boat (px). */
  readonly arrowRange: number
  /** Arrows ignore concentrations holding fewer cargo units than this. */
  readonly arrowMinUnits: number
  /** When no concentration meets `arrowMinUnits`, fall back to the nearest of any size. */
  readonly arrowFallback: boolean
  /** Arrow styling: faint and without a distance readout. */
  readonly subtle: boolean
  /** Concentrations are drawn on the minimap within this range of the boat (0 = not at all). */
  readonly minimapRange: number
  /** Individual remaining items are drawn on the minimap. */
  readonly minimapItems: boolean
  /** Detection precision, 0 (vague) .. 1 (exact). Drives marker size and distance rounding. */
  readonly precision: number
  /** Visual sonar pulses around the boat. */
  readonly pulse: boolean
}

export const NO_SENSORS: SensorProfile = {
  source: 'none',
  arrows: 0,
  arrowRange: 0,
  arrowMinUnits: Infinity,
  arrowFallback: false,
  subtle: false,
  minimapRange: 0,
  minimapItems: false,
  precision: 0,
  pulse: false,
}

/** Purchased sonar, level 0..5. */
export function sonarProfile(level: number): SensorProfile {
  const S = BALANCE.upgrades.sonar
  const l = Math.max(0, Math.min(S.arrows.length - 1, Math.floor(level)))
  if (l === 0) return NO_SENSORS
  return {
    source: 'sonar',
    arrows: S.arrows[l],
    arrowRange: S.arrowRange[l],
    // The Precision Scanner (L5) also finds isolated remnants; earlier levels look for substantial concentrations.
    arrowMinUnits: S.itemMarkers[l] ? 1 : BALANCE.assist.substantialUnits,
    arrowFallback: S.itemMarkers[l],
    subtle: false,
    minimapRange: S.minimapRange[l],
    minimapItems: S.itemMarkers[l],
    precision: l / S.arrows.length,
    pulse: true,
  }
}

/** 0 = no help yet, 1 = subtle hint, 2 = clear guidance, 3 = isolated debris. */
export function assistStage(progress: number): 0 | 1 | 2 | 3 {
  const A = BALANCE.assist
  const p = progress + 1e-9
  if (p >= A.isolatedAt) return 3
  if (p >= A.guidanceAt) return 2
  if (p >= A.hintAt) return 1
  return 0
}

/** Free late-game assistance. Available whatever has been purchased. */
export function assistProfile(stage: 0 | 1 | 2 | 3): SensorProfile {
  if (stage === 0) return NO_SENSORS
  const A = BALANCE.assist
  const base = { source: 'assist' as const, arrowRange: 99999, pulse: false }
  if (stage === 1) {
    return { ...base, arrows: A.arrows[0], arrowMinUnits: 1, arrowFallback: true, subtle: true, minimapRange: 0, minimapItems: false, precision: 0.25 }
  }
  if (stage === 2) {
    return { ...base, arrows: A.arrows[1], arrowMinUnits: A.substantialUnits, arrowFallback: true, subtle: false, minimapRange: 99999, minimapItems: false, precision: 0.5 }
  }
  return { ...base, arrows: A.arrows[2], arrowMinUnits: 1, arrowFallback: true, subtle: false, minimapRange: 99999, minimapItems: true, precision: 0.75 }
}

/** Best of both: the player always gets whichever source is more helpful for each capability. */
export function mergeProfiles(a: SensorProfile, b: SensorProfile): SensorProfile {
  if (a.source === 'none') return b
  if (b.source === 'none') return a
  return {
    source: a.precision >= b.precision ? a.source : b.source,
    arrows: Math.max(a.arrows, b.arrows),
    arrowRange: Math.max(a.arrowRange, b.arrowRange),
    arrowMinUnits: Math.min(a.arrowMinUnits, b.arrowMinUnits),
    arrowFallback: a.arrowFallback || b.arrowFallback,
    subtle: a.subtle && b.subtle,
    minimapRange: Math.max(a.minimapRange, b.minimapRange),
    minimapItems: a.minimapItems || b.minimapItems,
    precision: Math.max(a.precision, b.precision),
    pulse: a.pulse || b.pulse,
  }
}

/** What the player is shown, given sonar level and cleanup progress. */
export function sensorProfile(sonarLevel: number, progress: number): SensorProfile {
  return mergeProfiles(sonarProfile(sonarLevel), assistProfile(assistStage(progress)))
}

export interface SensorMarker {
  /** Stable key (patch id, or item id) so the UI can animate markers instead of recreating them. */
  readonly key: string
  readonly kind: 'cluster' | 'item'
  readonly x: number
  readonly y: number
  /** Marker radius in world px (vague at low precision). */
  readonly radius: number
  readonly units: number
  readonly items: number
  /** Distance from the boat to the marker centre (px). */
  readonly distance: number
}

export interface SensorReading {
  /** Arrow targets, nearest first. */
  readonly arrows: readonly SensorMarker[]
  /** Minimap overlays: concentrations in range, optionally with individual items. */
  readonly minimap: readonly SensorMarker[]
}

const EMPTY: SensorReading = { arrows: [], minimap: [] }

function clusterMarker(c: Concentration, boat: Point, precision: number): SensorMarker {
  return {
    key: c.patch,
    kind: 'cluster',
    x: c.x,
    y: c.y,
    // Low precision draws a bigger, vaguer blob around the same centre.
    radius: c.radius * (1 + (1 - precision) * 0.8),
    units: c.units,
    items: c.items,
    distance: Math.hypot(c.x - boat.x, c.y - boat.y),
  }
}

/** Read the sensors. Pure: depends only on the live debris field, the profile and the boat position. */
export function readSensors(field: DebrisField, profile: SensorProfile, boat: Point): SensorReading {
  if (profile.source === 'none') return EMPTY
  const all = field.concentrations()
  if (all.length === 0) return EMPTY

  const sorted = all
    .map((c) => clusterMarker(c, boat, profile.precision))
    .sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : 1))

  let arrows: SensorMarker[] = []
  if (profile.arrows > 0) {
    const inRange = sorted.filter((m) => m.distance <= profile.arrowRange)
    arrows = inRange.filter((m) => m.units >= profile.arrowMinUnits).slice(0, profile.arrows)
    if (arrows.length === 0 && profile.arrowFallback) arrows = inRange.slice(0, Math.min(profile.arrows, 1))
  }

  const minimap: SensorMarker[] = []
  if (profile.minimapRange > 0) {
    for (const m of sorted) if (m.distance <= profile.minimapRange) minimap.push(m)
  }
  if (profile.minimapItems) {
    for (const s of field.all()) {
      minimap.push({
        key: `i${s.id}`,
        kind: 'item',
        x: s.x,
        y: s.y,
        radius: 0,
        units: BALANCE.debris[s.type].cargo,
        items: 1,
        distance: Math.hypot(s.x - boat.x, s.y - boat.y),
      })
    }
  }
  return { arrows, minimap }
}

/** Distance label for an arrow: exact when the sensor is precise, rounded (with "~") when it is not. */
export function distanceLabel(distancePx: number, precision: number): string {
  const m = distancePx / 10
  if (precision >= 0.8) return `${Math.round(m / 10) * 10} m`
  if (precision >= 0.5) return `~${Math.round(m / 50) * 50} m`
  return `~${Math.round(m / 100) * 100} m`
}
