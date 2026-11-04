/**
 * Ocean Reclaimers - central game-balance configuration.
 *
 * Every gameplay number lives here so the game can be tuned without touching
 * any logic or rendering code. Distances are world pixels, times are seconds,
 * speeds are pixels per second.
 */

export type DebrisType = 'bottle' | 'container' | 'net'
export type UpgradeId = 'cargo' | 'engine' | 'width' | 'tender' | 'fleet'

export interface DebrisSpec {
  /** Cargo units occupied in the hold. */
  readonly cargo: number
  /** Credits paid when unloaded at the station. */
  readonly credits: number
  /** Base arcade score per item (multiplied by the combo). */
  readonly score: number
  /** Pickup radius (px). */
  readonly radius: number
  readonly label: string
}

export interface UpgradeSpec {
  readonly id: UpgradeId
  readonly name: string
  /** Base (design-table) price of each level, level 1 first. Scaled by `upgrades.priceScale`. */
  readonly baseCosts: readonly number[]
}

export interface ComboTier {
  readonly minChain: number
  readonly multiplier: number
}

export const BALANCE = {
  /** Boat handling: arcade feel with gentle momentum. */
  boat: {
    radius: 19,
    maxSpeed: 250,
    reverseFactor: 0.45,
    accel: 460,
    brake: 760,
    /** Coasting drag (1/s). Higher = stops faster when the throttle is released. */
    drag: 1.15,
    /** How quickly sideways drift is removed (1/s). Lower = more slide. */
    lateralGrip: 3.6,
    /** Turn rate (rad/s) at a standstill and at cruising speed. */
    turnRateLow: 1.9,
    turnRateHigh: 2.8,
    /** How quickly the boat reaches the commanded turn rate (1/s). */
    turnResponse: 12,
    boostSpeedMult: 1.55,
    boostAccelMult: 2.0,
    boostDuration: 1.5,
    boostCooldown: 4.5,
    /** Fraction of the normal velocity kept along the wall on impact. */
    wallSlide: 0.9,
    /** Bounciness of wall hits (0 = no bounce). */
    wallBounce: 0.12,
    /** Keep this distance from the world edge. */
    edgeMargin: 60,
  },

  /** Collection zone in front of the bow. */
  collection: {
    zoneLength: 86,
    zoneHalfWidth: 38,
    behindBow: 14,
  },

  cargo: {
    startCapacity: 20,
  },

  debris: {
    bottle: { cargo: 1, credits: 2, score: 10, radius: 10, label: 'Bottle' },
    container: { cargo: 2, credits: 4, score: 25, radius: 15, label: 'Container' },
    net: { cargo: 4, credits: 10, score: 60, radius: 24, label: 'Fishing net' },
  } as Record<DebrisType, DebrisSpec>,

  /**
   * Multi-level upgrades (v0.2). Each track has up to five levels bought in order.
   * Prices are `baseCosts[level-1] * priceScale`, rounded. The base table is the original design table; the scale
   * brings it in line with the credits that Coral Bay actually contains (see README, "Economy").
   */
  upgrades: {
    priceScale: 0.2,
    /** Cargo Hold: +5 units per level, 20 -> 45. */
    cargo: { id: 'cargo', name: 'Cargo Hold', perLevel: 5, baseCosts: [35, 60, 95, 145, 220] },
    /** Engine: +5% base speed and acceleration per level (relative to the original), up to +25%. */
    engine: { id: 'engine', name: 'Engine', perLevel: 0.05, baseCosts: [40, 70, 110, 170, 260] },
    /** Collection arms: +8% width per level (relative to the original), up to +40%. */
    width: { id: 'width', name: 'Collection Arms', perLevel: 0.08, baseCosts: [45, 80, 125, 190, 290] },
    /**
     * Cargo Tender track. L1 unlocks the first tender; L2 and L4 add capacity; L3 adds travel speed;
     * L5 unlocks automatic dispatch. Arrays are indexed by level (index 0 = no tender yet).
     */
    tender: {
      id: 'tender',
      name: 'Cargo Tender',
      baseCosts: [250, 150, 225, 325, 400],
      capacity: [0, 10, 15, 15, 25, 25],
      speedMult: [1, 1, 1, 1.35, 1.35, 1.35],
      /** The tender is offered after this many successful station visits so players feel the chore first. */
      minUnloadsToBuy: 3,
      autoDispatchLevel: 5,
    },
    /** Second Cargo Tender (a future version may allow a third). */
    fleet: { id: 'fleet', name: 'Second Tender', baseCosts: [300], requiresTenderLevel: 2 },
  },
  /** Cargo tender behaviour. Distances in px, times in seconds, speeds in px/s. */
  tender: {
    maxTenders: 2,
    baseSpeed: 265,
    accel: 520,
    turnRate: 3.4,
    radius: 14,
    /** Idle tenders hover this close to the player. */
    followRadius: 150,
    /** A requested tender loads once it is this close. */
    transferRange: 95,
    loadSeconds: 0.9,
    unloadSeconds: 1.1,
    /** Cargo is delivered when the tender is this close to the station dock point. */
    deliveryRadius: 150,
    /** Auto dispatch (tender L5) fires when the hold is at least this full. */
    autoDispatchFill: 0.7,
    autoDispatchCooldown: 5,
    /** A tender that makes less than `stuckMinMove` px of progress in `stuckCheckSeconds` re-plans, then recovers. */
    stuckCheckSeconds: 1.4,
    stuckMinMove: 12,
    /** Hard cap on any single leg; after this the tender is moved to safe water and carries on. */
    phaseTimeout: 75,
    replanSeconds: 0.8,
    /** Seconds between "no tender" style notices so messages never spam. */
    noticeCooldown: 2.5,
  },
  /** Navigation grid shared by all autonomous vessels. */
  nav: {
    cell: 40,
    /** Extra clearance around solid obstacles, on top of the vessel radius. */
    margin: 22,
  },
  /** Arcade combo: affects score only, never cargo or credits. */
  combo: {
    /** Seconds without a pickup before the chain resets. */
    window: 3.0,
    tiers: [
      { minChain: 3, multiplier: 1.2 },
      { minChain: 5, multiplier: 1.5 },
      { minChain: 10, multiplier: 2 },
    ] as ComboTier[],
  },

  progress: {
    /** Cleanup fractions that trigger visual rewards. */
    milestones: [0.25, 0.5, 0.75],
    /** Reaching this fraction completes the v0.1 goal. */
    completion: 0.75,
  },

  station: {
    /** Distance from the dock point within which E works. */
    interactRange: 175,
  },

  camera: {
    follow: 0.085,
    lookAhead: 120,
    lookAheadResponse: 2.5,
    boostZoomOut: 0.93,
  },

  audio: {
    master: 0.8,
    ambience: 0.22,
    engine: 0.05,
    sfx: 0.7,
  },

  save: {
    key: 'oceanreclaimers.save.v1', // v0.1 key kept so existing saves migrate
    settingsKey: 'oceanreclaimers.settings.v1',
    autosaveSeconds: 6,
  },
} as const
