/**
 * Ocean Reclaimers - central game-balance configuration.
 *
 * Every gameplay number lives here so the game can be tuned without touching
 * any logic or rendering code. Distances are world pixels, times are seconds,
 * speeds are pixels per second.
 */

export type DebrisType = 'bottle' | 'container' | 'net'
export type UpgradeId = 'cargo' | 'engine' | 'width'

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
  readonly blurb: string
  readonly cost: number
  /** Additive bonus (cargo units) or multiplier (engine, width), see `stats.ts`. */
  readonly value: number
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

  /** Each upgrade can be bought once in v0.1. */
  upgrades: {
    cargo: {
      id: 'cargo',
      name: 'Cargo Hold',
      blurb: '+10 cargo capacity',
      cost: 50,
      value: 10,
    },
    engine: {
      id: 'engine',
      name: 'Twin Engines',
      blurb: '+15% speed & acceleration',
      cost: 60,
      value: 1.15,
    },
    width: {
      id: 'width',
      name: 'Wide Net Arms',
      blurb: '+25% collection width',
      cost: 75,
      value: 1.25,
    },
  } as Record<UpgradeId, UpgradeSpec>,

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
    key: 'oceanreclaimers.save.v1',
    settingsKey: 'oceanreclaimers.settings.v1',
    autosaveSeconds: 6,
  },
} as const
