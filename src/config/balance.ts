/**
 * Ocean Reclaimers - central game-balance configuration.
 *
 * Every gameplay number lives here so the game can be tuned without touching
 * any logic or rendering code. Distances are world pixels, times are seconds,
 * speeds are pixels per second.
 */

export type DebrisType = 'bottle' | 'container' | 'net'
export type UpgradeId = 'cargo' | 'engine' | 'width' | 'tender' | 'fleet' | 'sonar' | 'trawler' | 'trawlerFleet'

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
    /**
     * Ocean Sonar (v0.3). Arrays are indexed by level (0 = none). Sonar only ever reports debris that is really still
     * in the water. Purchased sonar gives earlier access, longer range and more detail than the free late-game help
     * (see `assist`), but Coral Bay can always be finished without it.
     */
    sonar: {
      id: 'sonar',
      name: 'Ocean Sonar',
      baseCosts: [90, 150, 240, 360, 520],
      levelNames: ['No Sonar', 'Debris Scanner', 'Extended Detection', 'Ocean Sonar', 'Advanced Sonar', 'Precision Scanner'],
      /** Edge-of-screen direction arrows toward debris concentrations. */
      arrows: [0, 1, 3, 3, 4, 4],
      /** Arrow range from the boat (px). */
      arrowRange: [0, 1000, 1700, 2400, 99999, 99999],
      /** Concentrations shown on the minimap within this range of the boat (px); 0 = not shown. */
      minimapRange: [0, 0, 0, 1900, 99999, 99999],
      /** Individual remaining items (isolated debris) shown on the minimap and pinged in the water. */
      itemMarkers: [false, false, false, false, false, true],
      /** Seconds between sonar pulses (visual only). */
      pulseSeconds: 4.5,
    },
    /** Autonomous Cleanup Trawlers (v0.3). Level 1 unlocks the first trawler; `trawlerFleet` adds the second. */
    trawler: {
      id: 'trawler',
      name: 'Auto Trawler',
      baseCosts: [300, 150, 200, 275, 350],
      /** Cargo units each trawler carries. */
      capacity: [0, 6, 10, 10, 12, 14],
      /** Travel speed (px/s). The player's boat does 250 before upgrades. */
      speed: [0, 135, 135, 170, 170, 195],
      /** Seconds a trawler spends scooping one item. */
      collectSeconds: [0, 0.9, 0.9, 0.55, 0.55, 0.4],
      /** How close (px) a trawler must get to an item to scoop it. */
      collectRadius: [0, 40, 40, 44, 46, 50],
      /** How far (px) a trawler looks for debris from where it is before it gives up and goes home. */
      detectRange: [0, 520, 520, 520, 900, 1100],
      /** Route efficiency: L4+ prefers items that make for a shorter trip home (0 = plain nearest-first). */
      routeBias: [0, 0, 0, 0, 0.3, 0.3],
      /** Seconds to unload at the station. */
      unloadSeconds: [0, 1.4, 1.4, 1.2, 1.2, 0.9],
    },
    trawlerFleet: { id: 'trawlerFleet', name: 'Second Trawler', baseCosts: [350], requiresTrawlerLevel: 2 },
  },
  /** Autonomous trawler behaviour. Distances in px, times in seconds, speeds in px/s. */
  trawler: {
    maxTrawlers: 2,
    accel: 420,
    turnRate: 3.0,
    radius: 14,
    departSeconds: 1.0,
    deliveryRadius: 150,
    /** Within this distance of its target a trawler is "Collecting"; farther away it is still "Searching". */
    collectingWithin: 300,
    /** Inside this distance the trawler leaves its route and homes straight in on the item. */
    approachRadius: 140,
    /** An item that cannot be reached within this many seconds of approach is left for the player. */
    approachTimeout: 9,
    /** Trawlers do not pick new targets within this distance (px) of the player's boat: that plastic is yours to scoop. */
    yieldToPlayerRadius: 420,
    /** How often an idle trawler looks for work again. */
    retrySeconds: 1.5,
    /** Same stall detection / hard timeout as tenders. */
    stuckCheckSeconds: 1.4,
    stuckMinMove: 12,
    phaseTimeout: 90,
    replanSeconds: 0.8,
    /** A trawler never gives up while the station can still be reached; this caps pointless single-item trips. */
    returnWhenFullFraction: 0.99,
  },
  /**
   * Free late-game debris assistance (v0.3). Independent of sonar purchases, so Coral Bay never ends with minutes of
   * aimless searching. Thresholds are cleanup fractions.
   */
  assist: {
    /** Subtle hint toward the nearest remaining concentration. */
    hintAt: 0.6,
    /** Clear directional guidance toward substantial concentrations. */
    guidanceAt: 0.65,
    /** Help locating isolated remaining debris. */
    isolatedAt: 0.7,
    /** A patch counts as a "substantial concentration" when it still holds at least this many cargo units. */
    substantialUnits: 6,
    /** Maximum arrows shown by assistance at each stage. */
    arrows: [1, 2, 3],
  },
  /** Arcade scoring, completion-time bonus and the local leaderboard (v0.3). */
  scoring: {
    /** Completion-time multipliers: the first band whose `below` (seconds, exclusive) exceeds the time applies. */
    timeBands: [
      { below: 240, multiplier: 1.5 },
      { below: 300, multiplier: 1.35 },
      { below: 360, multiplier: 1.2 },
      { below: 480, multiplier: 1.1 },
    ],
    /** Used when the time is past every band ("over 8 minutes"). */
    slowMultiplier: 1.0,
    leaderboardSize: 10,
    nameMaxLength: 12,
    defaultName: 'CAPTAIN',
    /** Score-table partition: scores are only ever compared inside the same region + mode. */
    region: 'coral-bay',
    mode: 'standard',
    /** Bump when gameplay balance changes enough that old scores are no longer comparable. */
    balanceVersion: '0.3.0',
  },
  hud: {
    /** The station arrow shows whenever the dock is closer than this many px to / outside the screen edge. */
    stationClearMargin: 70,
    /** Minimap size in CSS px (compact / expanded), width only; height follows the world aspect ratio. */
    minimapWidth: 188,
    minimapWidthExpanded: 400,
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
    /** Leaderboard lives under its own key so New Game never erases high scores. */
    scoresKey: 'oceanreclaimers.scores.v1',
    settingsKey: 'oceanreclaimers.settings.v1',
    autosaveSeconds: 6,
  },
} as const
