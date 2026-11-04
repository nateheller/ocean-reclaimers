/** Cargo hold: whole-item storage with a hard capacity. */
import { BALANCE, type DebrisType } from '../config/balance'

export type CargoCounts = Record<DebrisType, number>

export const DEBRIS_TYPES: readonly DebrisType[] = ['bottle', 'container', 'net']

export function emptyCargo(): CargoCounts {
  return { bottle: 0, container: 0, net: 0 }
}

export function cargoUnits(counts: CargoCounts): number {
  return DEBRIS_TYPES.reduce((sum, t) => sum + counts[t] * BALANCE.debris[t].cargo, 0)
}

export function cargoCredits(counts: CargoCounts): number {
  return DEBRIS_TYPES.reduce((sum, t) => sum + counts[t] * BALANCE.debris[t].credits, 0)
}

/** True when a whole item of this type fits. No partial pickups, no overflow. */
export function canFit(counts: CargoCounts, capacity: number, type: DebrisType): boolean {
  return cargoUnits(counts) + BALANCE.debris[type].cargo <= capacity
}
