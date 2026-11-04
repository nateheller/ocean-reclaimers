/**
 * Gameplay events and run statistics.
 *
 * The model emits a small typed event for everything that could one day count toward an achievement or cosmetic
 * unlock (collections, combos, deliveries, purchases, milestones). `RunStats` keeps the running totals and is saved
 * with the game. Future achievement code only needs to subscribe via `GameModel.listen`; core collection logic does
 * not need to change.
 */
import type { DebrisType, UpgradeId } from '../config/balance'
import type { CargoCounts } from './cargo'

export type GameEvent =
  | { type: 'collected'; debris: DebrisType; chain: number; multiplier: number; scoreGained: number }
  | { type: 'comboReached'; chain: number; multiplier: number }
  | { type: 'unloaded'; items: number; units: number; credits: number }
  | { type: 'purchased'; id: UpgradeId; level: number; cost: number }
  | { type: 'milestone'; milestone: number }
  | { type: 'completed' }
  | { type: 'tenderDispatched'; tenderId: number; auto: boolean }
  | { type: 'tenderLoaded'; tenderId: number; units: number }
  | { type: 'tenderDelivered'; tenderId: number; units: number; credits: number; counts: CargoCounts }
  | { type: 'trawlerCollected'; trawlerId: number; debris: DebrisType; units: number }
  | { type: 'trawlerDelivered'; trawlerId: number; units: number; credits: number; counts: CargoCounts }

export interface RunStats {
  collected: Record<DebrisType, number>
  bestChain: number
  unloads: number
  creditsEarned: number
  creditsSpent: number
  upgradesBought: number
  tenderDispatches: number
  tenderDeliveries: number
  tenderUnits: number
  tenderCredits: number
  /** Trawlers launched (one per trawler owned). */
  trawlerDeployments: number
  trawlerCollected: number
  trawlerDeliveries: number
  trawlerUnits: number
  trawlerCredits: number
}

export function emptyRunStats(): RunStats {
  return {
    collected: { bottle: 0, container: 0, net: 0 },
    bestChain: 0,
    unloads: 0,
    creditsEarned: 0,
    creditsSpent: 0,
    upgradesBought: 0,
    tenderDispatches: 0,
    tenderDeliveries: 0,
    tenderUnits: 0,
    tenderCredits: 0,
    trawlerDeployments: 0,
    trawlerCollected: 0,
    trawlerDeliveries: 0,
    trawlerUnits: 0,
    trawlerCredits: 0,
  }
}

/** Fold one event into the totals. Pure and total: unknown events leave stats unchanged. */
export function applyEvent(stats: RunStats, e: GameEvent): void {
  switch (e.type) {
    case 'collected':
      stats.collected[e.debris] += 1
      stats.bestChain = Math.max(stats.bestChain, e.chain)
      break
    case 'unloaded':
      if (e.items > 0) stats.unloads += 1
      stats.creditsEarned += e.credits
      break
    case 'purchased':
      stats.upgradesBought += 1
      stats.creditsSpent += e.cost
      break
    case 'tenderDispatched':
      stats.tenderDispatches += 1
      break
    case 'tenderDelivered':
      stats.tenderDeliveries += 1
      stats.tenderUnits += e.units
      stats.tenderCredits += e.credits
      stats.creditsEarned += e.credits
      break
    case 'trawlerCollected':
      stats.trawlerCollected += 1
      break
    case 'trawlerDelivered':
      stats.trawlerDeliveries += 1
      stats.trawlerUnits += e.units
      stats.trawlerCredits += e.credits
      stats.creditsEarned += e.credits
      break
    default:
      break
  }
}
