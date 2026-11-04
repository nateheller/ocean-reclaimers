/**
 * Coral Bay - the designed map. Positions are hand-placed; only the exact
 * scatter inside each debris patch and the island decorations are seeded.
 */
import type { DebrisType } from './balance'

export type ZoneId = 'harbor' | 'shallows' | 'open'

export interface Lobe {
  readonly dx: number
  readonly dy: number
  readonly r: number
}

export interface IslandDef {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly lobes: readonly Lobe[]
  /** Number of palm trees to scatter on the island. */
  readonly palms: number
}

export interface ObstacleSpot {
  readonly x: number
  readonly y: number
  readonly r: number
}

export interface PatchDef {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly counts: Readonly<Record<DebrisType, number>>
}

export const WORLD = {
  width: 5600,
  height: 3600,
  /** Master seed for debris scatter and decorations. */
  seed: 20301,
  /** Boat spawn and dock interaction point: the mouth of the docking slip between the jetties. Navigation aids point here. */
  spawn: { x: 880, y: 3010, heading: -0.45 },
  dock: { x: 700, y: 3020 },
  /** Distance from the dock that bounds each area. */
  harborRadius: 1050,
  shallowsRadius: 2450,
  names: {
    harbor: 'Harbor',
    shallows: 'The Shallows',
    open: 'Open Water',
  } as Record<ZoneId, string>,
} as const

/** Landmass carrying the cleanup station (solid). */
export const STATION_LAND: readonly ObstacleSpot[] = [
  { x: 250, y: 3200, r: 300 },
  { x: 520, y: 3350, r: 230 },
  { x: 120, y: 2900, r: 190 },
  { x: 430, y: 3100, r: 190 },
]

/** Two wooden jetties frame the docking slip at y = dock.y (solid). */
export const STATION_JETTIES: readonly { x0: number; x1: number; y: number }[] = [
  { x0: 590, x1: 700, y: 2975 },
  { x0: 590, x1: 700, y: 3065 },
]

export const ISLANDS: readonly IslandDef[] = [
  {
    id: 'breakwater',
    x: 1180,
    y: 3340,
    palms: 2,
    lobes: [
      { dx: 0, dy: 0, r: 75 },
      { dx: 95, dy: 20, r: 55 },
    ],
  },
  {
    id: 'palm-cay',
    x: 1950,
    y: 2520,
    palms: 5,
    lobes: [
      { dx: 0, dy: 0, r: 130 },
      { dx: 120, dy: 60, r: 88 },
      { dx: -105, dy: 55, r: 78 },
    ],
  },
  {
    id: 'turtle-isle',
    x: 1330,
    y: 1700,
    palms: 8,
    lobes: [
      { dx: 0, dy: 0, r: 170 },
      { dx: 160, dy: -70, r: 110 },
      { dx: -130, dy: 90, r: 100 },
      { dx: 30, dy: 160, r: 80 },
    ],
  },
  {
    id: 'sandbar',
    x: 2950,
    y: 2950,
    palms: 3,
    lobes: [
      { dx: 0, dy: 0, r: 140 },
      { dx: 130, dy: 80, r: 95 },
    ],
  },
  {
    id: 'reef-head',
    x: 2750,
    y: 1850,
    palms: 2,
    lobes: [
      { dx: 0, dy: 0, r: 100 },
      { dx: -90, dy: 70, r: 70 },
    ],
  },
  {
    id: 'big-key',
    x: 3950,
    y: 1280,
    palms: 10,
    lobes: [
      { dx: 0, dy: 0, r: 220 },
      { dx: 210, dy: 100, r: 150 },
      { dx: -190, dy: 120, r: 130 },
      { dx: 30, dy: -190, r: 120 },
    ],
  },
  {
    id: 'eastern-isle',
    x: 4750,
    y: 2450,
    palms: 5,
    lobes: [
      { dx: 0, dy: 0, r: 160 },
      { dx: 140, dy: -95, r: 100 },
    ],
  },
  {
    id: 'north-spit',
    x: 3250,
    y: 520,
    palms: 6,
    lobes: [
      { dx: 0, dy: 0, r: 180 },
      { dx: -170, dy: 85, r: 110 },
    ],
  },
  {
    id: 'west-head',
    x: 1000,
    y: 720,
    palms: 7,
    lobes: [
      { dx: 0, dy: 0, r: 200 },
      { dx: 190, dy: -60, r: 120 },
    ],
  },
  {
    id: 'little-cay',
    x: 2250,
    y: 960,
    palms: 2,
    lobes: [
      { dx: 0, dy: 0, r: 80 },
      { dx: 70, dy: 40, r: 55 },
    ],
  },
  {
    id: 'far-south',
    x: 4350,
    y: 3250,
    palms: 3,
    lobes: [
      { dx: 0, dy: 0, r: 110 },
      { dx: 100, dy: -40, r: 70 },
    ],
  },
]

/** Single solid rocks. */
export const ROCKS: readonly ObstacleSpot[] = [
  { x: 1500, y: 2960, r: 38 },
  { x: 1020, y: 2640, r: 30 },
  { x: 1750, y: 3180, r: 44 },
  { x: 1580, y: 2300, r: 40 },
  { x: 2500, y: 2250, r: 46 },
  { x: 2330, y: 3350, r: 38 },
  { x: 1750, y: 1950, r: 34 },
  { x: 2050, y: 1300, r: 42 },
  { x: 3350, y: 2350, r: 50 },
  { x: 3650, y: 2750, r: 40 },
  { x: 3000, y: 1500, r: 36 },
  { x: 4300, y: 1900, r: 48 },
  { x: 4850, y: 1650, r: 40 },
  { x: 3600, y: 1750, r: 34 },
  { x: 2700, y: 800, r: 44 },
  { x: 1750, y: 520, r: 38 },
  { x: 4600, y: 700, r: 46 },
  { x: 5100, y: 3000, r: 42 },
  { x: 3900, y: 3400, r: 36 },
  { x: 5000, y: 1100, r: 40 },
]

/** Solid coral reef heads (shallow water hazards). */
export const REEFS: readonly ObstacleSpot[] = [
  { x: 1650, y: 2680, r: 52 },
  { x: 1450, y: 2200, r: 60 },
  { x: 2200, y: 2900, r: 56 },
  { x: 2620, y: 2520, r: 64 },
  { x: 2050, y: 1700, r: 58 },
  { x: 1750, y: 1100, r: 62 },
  { x: 2950, y: 2150, r: 54 },
  { x: 3150, y: 3250, r: 60 },
  { x: 2500, y: 1250, r: 50 },
  { x: 1200, y: 2200, r: 48 },
  { x: 2400, y: 1950, r: 44 },
]

/**
 * Debris patches. Harbor: small and easy. Shallows: moderate. Open Water: big
 * patches far from the station, rich in nets.
 */
export const PATCHES: readonly PatchDef[] = [
  // --- Harbor ---
  { id: 'h1', x: 1080, y: 2840, radius: 235, counts: { bottle: 8, container: 2, net: 0 } },
  { id: 'h2', x: 1400, y: 3120, radius: 215, counts: { bottle: 6, container: 2, net: 0 } },
  { id: 'h3', x: 1180, y: 2420, radius: 235, counts: { bottle: 7, container: 3, net: 0 } },
  { id: 'h4', x: 1700, y: 2760, radius: 265, counts: { bottle: 6, container: 3, net: 1 } },
  { id: 'h5', x: 830, y: 2520, radius: 190, counts: { bottle: 5, container: 1, net: 0 } },
  // --- The Shallows ---
  { id: 's1', x: 1900, y: 2000, radius: 220, counts: { bottle: 8, container: 4, net: 1 } },
  { id: 's2', x: 2400, y: 2600, radius: 220, counts: { bottle: 8, container: 4, net: 2 } },
  { id: 's3', x: 1600, y: 1350, radius: 200, counts: { bottle: 6, container: 4, net: 1 } },
  { id: 's4', x: 3050, y: 2450, radius: 240, counts: { bottle: 8, container: 5, net: 1 } },
  { id: 's5', x: 2300, y: 1500, radius: 200, counts: { bottle: 7, container: 4, net: 1 } },
  { id: 's6', x: 2100, y: 3200, radius: 200, counts: { bottle: 6, container: 4, net: 1 } },
  // --- Open Water ---
  { id: 'o1', x: 3650, y: 2000, radius: 320, counts: { bottle: 12, container: 8, net: 3 } },
  { id: 'o2', x: 4550, y: 1500, radius: 340, counts: { bottle: 12, container: 8, net: 4 } },
  { id: 'o3', x: 3000, y: 850, radius: 300, counts: { bottle: 10, container: 8, net: 3 } },
  { id: 'o4', x: 4900, y: 3050, radius: 320, counts: { bottle: 12, container: 8, net: 3 } },
  { id: 'o5', x: 1550, y: 480, radius: 300, counts: { bottle: 10, container: 7, net: 3 } },
  { id: 'o6', x: 4250, y: 600, radius: 320, counts: { bottle: 12, container: 8, net: 4 } },
]
