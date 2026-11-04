/** Derived vessel stats for a set of purchased upgrades. */
import { BALANCE, type UpgradeId } from '../config/balance'

export type UpgradeFlags = Record<UpgradeId, boolean>

export const UPGRADE_IDS: readonly UpgradeId[] = ['cargo', 'engine', 'width']

export function noUpgrades(): UpgradeFlags {
  return { cargo: false, engine: false, width: false }
}

export interface VesselStats {
  readonly capacity: number
  readonly engineMult: number
  readonly maxSpeed: number
  readonly accel: number
  readonly zoneHalfWidth: number
  readonly zoneLength: number
}

export function vesselStats(up: UpgradeFlags): VesselStats {
  const engineMult = up.engine ? BALANCE.upgrades.engine.value : 1
  return {
    capacity: BALANCE.cargo.startCapacity + (up.cargo ? BALANCE.upgrades.cargo.value : 0),
    engineMult,
    maxSpeed: BALANCE.boat.maxSpeed * engineMult,
    accel: BALANCE.boat.accel * engineMult,
    zoneHalfWidth: BALANCE.collection.zoneHalfWidth * (up.width ? BALANCE.upgrades.width.value : 1),
    zoneLength: BALANCE.collection.zoneLength,
  }
}
