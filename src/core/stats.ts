/** Derived stats for a set of upgrade levels. Pure functions: the single place where levels become numbers. */
import { BALANCE } from '../config/balance'
import { noUpgrades, UPGRADE_IDS, type UpgradeLevels } from './upgrades'

export { noUpgrades, UPGRADE_IDS }
export type { UpgradeLevels }

export interface VesselStats {
  readonly boostDuration: number
  readonly boostCooldown: number
  readonly capacity: number
  readonly engineMult: number
  readonly maxSpeed: number
  readonly accel: number
  readonly widthMult: number
  readonly zoneHalfWidth: number
  readonly zoneLength: number
}

export function vesselStats(levels: Readonly<UpgradeLevels>): VesselStats {
  const U = BALANCE.upgrades
  const engineMult = 1 + levels.engine * U.engine.perLevel
  const widthMult = 1 + levels.width * U.width.perLevel
  return {
    boostDuration: U.boostReserve.duration[levels.boostReserve],
    boostCooldown: U.boostRecovery.cooldown[levels.boostRecovery],
    capacity: BALANCE.cargo.startCapacity + levels.cargo * U.cargo.perLevel,
    engineMult,
    maxSpeed: BALANCE.boat.maxSpeed * engineMult,
    accel: BALANCE.boat.accel * engineMult,
    widthMult,
    zoneHalfWidth: BALANCE.collection.zoneHalfWidth * widthMult,
    zoneLength: BALANCE.collection.zoneLength,
  }
}

export interface TenderStats {
  /** How many tenders the fleet owns. */
  readonly count: number
  /** Cargo units each tender can carry. */
  readonly capacity: number
  readonly speed: number
  readonly autoDispatch: boolean
}

export function tenderStats(levels: Readonly<UpgradeLevels>): TenderStats {
  const T = BALANCE.upgrades.tender
  const lvl = Math.min(levels.tender, T.capacity.length - 1)
  const count = lvl <= 0 ? 0 : Math.min(BALANCE.tender.maxTenders, 1 + levels.fleet)
  return {
    count,
    capacity: T.capacity[lvl],
    speed: BALANCE.tender.baseSpeed * T.speedMult[lvl],
    autoDispatch: lvl >= T.autoDispatchLevel,
  }
}

export interface TrawlerStats {
  /** How many trawlers the fleet owns. */
  readonly count: number
  readonly capacity: number
  /** Travel speed (px/s). */
  readonly speed: number
  /** Seconds to scoop one item. */
  readonly collectSeconds: number
  /** Reach (px) for scooping an item. */
  readonly collectRadius: number
  /** How far (px) a trawler searches for debris from where it is. */
  readonly detectRange: number
  /** Route efficiency bias (see BALANCE.upgrades.trawler.routeBias). */
  readonly routeBias: number
  readonly unloadSeconds: number
}

export function trawlerStats(levels: Readonly<UpgradeLevels>): TrawlerStats {
  const T = BALANCE.upgrades.trawler
  const lvl = Math.max(0, Math.min(levels.trawler, T.capacity.length - 1))
  const count = lvl <= 0 ? 0 : Math.min(BALANCE.trawler.maxTrawlers, 1 + levels.trawlerFleet)
  return {
    count,
    capacity: T.capacity[lvl],
    speed: T.speed[lvl],
    collectSeconds: T.collectSeconds[lvl],
    collectRadius: T.collectRadius[lvl],
    detectRange: T.detectRange[lvl],
    routeBias: T.routeBias[lvl],
    unloadSeconds: T.unloadSeconds[lvl],
  }
}
