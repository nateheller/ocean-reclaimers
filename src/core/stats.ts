/** Derived stats for a set of upgrade levels. Pure functions: the single place where levels become numbers. */
import { BALANCE } from '../config/balance'
import { noUpgrades, UPGRADE_IDS, type UpgradeLevels } from './upgrades'

export { noUpgrades, UPGRADE_IDS }
export type { UpgradeLevels }

export interface VesselStats {
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
