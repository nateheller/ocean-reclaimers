/** The shared navigation grid for Coral Bay, built lazily once. */
import { BALANCE } from '../config/balance'
import { NavGrid } from './nav'
import { buildObstacles, type Circle } from './worldgen'

let cachedObstacles: Circle[] | null = null
let cachedNav: NavGrid | null = null

export function worldObstacles(): readonly Circle[] {
  return (cachedObstacles ??= buildObstacles())
}

export function worldNav(): NavGrid {
  return (cachedNav ??= new NavGrid(worldObstacles(), BALANCE.tender.radius + BALANCE.nav.margin))
}
