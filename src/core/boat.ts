/** Arcade boat physics: gentle momentum, responsive steering. Pure and deterministic. */
import { BALANCE } from '../config/balance'
import { WORLD } from '../config/world'
import type { VesselStats } from './stats'
import type { Circle } from './worldgen'

export interface BoatState {
  x: number
  y: number
  heading: number
  vx: number
  vy: number
  turnVel: number
  boostLeft: number
  boostCooldown: number
  /** Captured on activation: purchases apply to the next burst, never resize an active cycle. */
  boostCycleDuration: number
  boostCycleCooldown: number
}

export interface BoatInput {
  /** -1 reverse .. 1 forward */
  throttle: number
  /** -1 left .. 1 right */
  steer: number
  /** True only on the frame boost was requested. */
  boost: boolean
}

export interface StepEvents {
  boostStarted: boolean
  boostEnded: boolean
  /** Speed of the strongest wall impact this step (px/s), 0 if none. */
  impact: number
  impactX: number
  impactY: number
}

export function createBoat(x: number = WORLD.spawn.x, y: number = WORLD.spawn.y, heading: number = WORLD.spawn.heading): BoatState {
  return { x, y, heading, vx: 0, vy: 0, turnVel: 0, boostLeft: 0, boostCooldown: 0,
    boostCycleDuration: BALANCE.boat.boostDuration, boostCycleCooldown: BALANCE.boat.boostCooldown }
}

export function boatSpeed(b: BoatState): number {
  return Math.hypot(b.vx, b.vy)
}

export function isBoosting(b: BoatState): boolean {
  return b.boostLeft > 0
}

/** 0 = ready .. 1 = just used. */
export function boostCooldownFraction(b: BoatState): number {
  const total = b.boostCycleDuration + b.boostCycleCooldown
  const remaining = b.boostLeft > 0 ? b.boostLeft + b.boostCycleCooldown : b.boostCooldown
  return Math.max(0, Math.min(1, remaining / total))
}

export function boostReady(b: BoatState): boolean {
  return b.boostLeft <= 0 && b.boostCooldown <= 0
}

export function stepBoat(b: BoatState, input: BoatInput, stats: VesselStats, dt: number): StepEvents {
  const P = BALANCE.boat
  const ev: StepEvents = { boostStarted: false, boostEnded: false, impact: 0, impactX: 0, impactY: 0 }

  // Boost timers.
  if (input.boost && boostReady(b)) {
    b.boostCycleDuration = stats.boostDuration
    b.boostCycleCooldown = stats.boostCooldown
    b.boostLeft = b.boostCycleDuration
    ev.boostStarted = true
  }
  if (b.boostLeft > 0) {
    b.boostLeft -= dt
    if (b.boostLeft <= 0) {
      b.boostLeft = 0
      b.boostCooldown = b.boostCycleCooldown
      ev.boostEnded = true
    }
  } else if (b.boostCooldown > 0) {
    b.boostCooldown = Math.max(0, b.boostCooldown - dt)
  }
  const boosting = b.boostLeft > 0

  const fx = Math.cos(b.heading)
  const fy = Math.sin(b.heading)
  let fwd = b.vx * fx + b.vy * fy
  let lat = -b.vx * fy + b.vy * fx

  const throttle = boosting ? 1 : input.throttle
  const maxForward = stats.maxSpeed * (boosting ? P.boostSpeedMult : 1)
  const accel = stats.accel * (boosting ? P.boostAccelMult : 1)

  if (throttle > 0) {
    const target = maxForward * throttle
    if (fwd < target) fwd = Math.min(target, fwd + accel * dt * (fwd < 0 ? 1.6 : 1))
    else fwd = Math.max(target, fwd - P.brake * 0.55 * dt) // easing off after a boost
  } else if (throttle < 0) {
    const target = -stats.maxSpeed * P.reverseFactor
    if (fwd > target) fwd = Math.max(target, fwd - (fwd > 0 ? P.brake : accel * 0.8) * dt)
  } else {
    fwd *= Math.exp(-P.drag * dt)
    if (Math.abs(fwd) < 1.5) fwd = 0
  }

  lat *= Math.exp(-P.lateralGrip * dt)

  // Steering: available at a standstill but stronger when moving, with a little inertia.
  const speedFactor = Math.min(1, Math.abs(fwd) / (stats.maxSpeed * 0.55))
  const turnRate = P.turnRateLow + (P.turnRateHigh - P.turnRateLow) * speedFactor
  const wantedTurn = input.steer * turnRate * (0.35 + 0.65 * Math.min(1, Math.abs(fwd) / 40 + (input.throttle !== 0 ? 0.35 : 0)))
  b.turnVel += (wantedTurn - b.turnVel) * (1 - Math.exp(-P.turnResponse * dt))
  b.heading += b.turnVel * dt

  const nfx = Math.cos(b.heading)
  const nfy = Math.sin(b.heading)
  b.vx = nfx * fwd - nfy * lat
  b.vy = nfy * fwd + nfx * lat
  b.x += b.vx * dt
  b.y += b.vy * dt

  // World edge: soft clamp that zeroes outward velocity.
  const m = P.edgeMargin
  if (b.x < m) { b.x = m; if (b.vx < 0) b.vx = 0 }
  if (b.y < m) { b.y = m; if (b.vy < 0) b.vy = 0 }
  if (b.x > WORLD.width - m) { b.x = WORLD.width - m; if (b.vx > 0) b.vx = 0 }
  if (b.y > WORLD.height - m) { b.y = WORLD.height - m; if (b.vy > 0) b.vy = 0 }

  return ev
}

/**
 * Push the boat out of solid circles. Forgiving: the boat slides along the
 * surface, keeps most of its tangential speed and takes no damage.
 * Returns the impact speed of the hardest hit (0 if none).
 */
export function resolveCollisions(
  b: BoatState,
  obstacles: readonly Circle[],
  out?: { x: number; y: number },
): number {
  const P = BALANCE.boat
  let hardest = 0
  for (const o of obstacles) {
    const dx = b.x - o.x
    const dy = b.y - o.y
    const min = o.r + P.radius
    const d2 = dx * dx + dy * dy
    if (d2 >= min * min) continue
    const d = Math.sqrt(d2) || 0.0001
    const nx = dx / d
    const ny = dy / d
    b.x = o.x + nx * min
    b.y = o.y + ny * min
    const vn = b.vx * nx + b.vy * ny
    if (vn < 0) {
      const impact = -vn
      b.vx -= vn * nx * (1 + P.wallBounce)
      b.vy -= vn * ny * (1 + P.wallBounce)
      // Slide, but shave a little speed so scraping a wall is not free.
      b.vx *= P.wallSlide + (1 - P.wallSlide) * 0.5
      b.vy *= P.wallSlide + (1 - P.wallSlide) * 0.5
      if (impact > hardest) {
        hardest = impact
        if (out) {
          out.x = o.x + nx * o.r
          out.y = o.y + ny * o.r
        }
      }
    }
  }
  return hardest
}

/** Is a point inside the oriented collection zone in front of the boat? */
export function inCollectionZone(
  b: Pick<BoatState, 'x' | 'y' | 'heading'>,
  px: number,
  py: number,
  itemRadius: number,
  stats: Pick<VesselStats, 'zoneHalfWidth' | 'zoneLength'>,
): boolean {
  const dx = px - b.x
  const dy = py - b.y
  const c = Math.cos(b.heading)
  const s = Math.sin(b.heading)
  const u = dx * c + dy * s // along heading
  const w = -dx * s + dy * c // sideways
  const bowOffset = BALANCE.boat.radius
  const back = bowOffset - BALANCE.collection.behindBow
  return (
    u >= back - itemRadius * 0.3 &&
    u <= bowOffset + stats.zoneLength + itemRadius * 0.4 &&
    Math.abs(w) <= stats.zoneHalfWidth + itemRadius * 0.5
  )
}

export function distanceToDock(b: Pick<BoatState, 'x' | 'y'>): number {
  return Math.hypot(b.x - WORLD.dock.x, b.y - WORLD.dock.y)
}

export function inDockRange(b: Pick<BoatState, 'x' | 'y'>): boolean {
  return distanceToDock(b) <= BALANCE.station.interactRange
}
