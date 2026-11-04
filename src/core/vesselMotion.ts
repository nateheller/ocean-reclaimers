/**
 * Movement for autonomous vessels (pure simulation).
 *
 * The cargo tender fleet has its own, proven copy of this logic and is deliberately left untouched; the autonomous
 * trawlers use this module. Both lean on the same `NavGrid`: A* over free water, string-pulled into clean lines.
 *
 * A `Mover` owns every piece of its own state (position, path, stall detection), so vessels can never interfere with
 * each other through shared data.
 */
import type { NavGrid, Vec } from './nav'
import type { Circle } from './worldgen'

export interface Mover {
  x: number
  y: number
  heading: number
  /** Scalar speed along the heading (px/s). */
  speed: number
  path: Vec[]
  /** Where the current path was aimed, to notice a moving goal. */
  pathGoal: Vec | null
  replanTimer: number
  stuckTimer: number
  stuckRef: Vec
  stuckCount: number
}

export interface MotionParams {
  accel: number
  turnRate: number
  radius: number
  replanSeconds: number
  stuckCheckSeconds: number
  stuckMinMove: number
}

export type DriveResult = 'moving' | 'arrived' | 'stalled' | 'unroutable'

export function newMover(x: number, y: number, heading: number): Mover {
  return {
    x,
    y,
    heading,
    speed: 0,
    path: [],
    pathGoal: null,
    replanTimer: 0,
    stuckTimer: 0,
    stuckRef: { x, y },
    stuckCount: 0,
  }
}

/** Forget the current route and stall history (call when the goal changes completely). */
export function resetRoute(m: Mover): void {
  m.path = []
  m.pathGoal = null
  m.replanTimer = 0
  m.stuckTimer = 0
  m.stuckCount = 0
  m.stuckRef = { x: m.x, y: m.y }
}

function advance(m: Mover, dt: number): void {
  m.x += Math.cos(m.heading) * m.speed * dt
  m.y += Math.sin(m.heading) * m.speed * dt
}

export function coast(m: Mover, dt: number, accel: number): void {
  m.speed = Math.max(0, m.speed - accel * 1.4 * dt)
  advance(m, dt)
}

/** Soft collision: slide off solid obstacles instead of passing through them. */
export function pushOut(m: Mover, obstacles: readonly Circle[], radius: number): void {
  for (const o of obstacles) {
    const dx = m.x - o.x
    const dy = m.y - o.y
    const min = o.r + radius
    const d2 = dx * dx + dy * dy
    if (d2 >= min * min) continue
    const d = Math.sqrt(d2) || 0.0001
    m.x = o.x + (dx / d) * min
    m.y = o.y + (dy / d) * min
  }
}

function turnToward(m: Mover, wantX: number, wantY: number, dt: number, params: MotionParams): number {
  const want = Math.atan2(wantY - m.y, wantX - m.x)
  let diff = want - m.heading
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const maxTurn = params.turnRate * dt
  m.heading += Math.max(-maxTurn, Math.min(maxTurn, diff))
  return diff
}

function accelerate(m: Mover, target: number, dt: number, accel: number): void {
  if (m.speed < target) m.speed = Math.min(target, m.speed + accel * dt)
  else m.speed = Math.max(target, m.speed - accel * 1.5 * dt)
}

/**
 * Follow a route to `goal`, re-planning when needed. Returns:
 *  - 'moving'     still travelling,
 *  - 'arrived'    reached the end of the route (within `reach` px),
 *  - 'stalled'    no real progress for several checks: the caller should recover,
 *  - 'unroutable' the planner repeatedly found no route.
 */
export function drive(
  m: Mover,
  goal: Vec,
  dt: number,
  nav: NavGrid,
  obstacles: readonly Circle[],
  maxSpeed: number,
  reach: number,
  params: MotionParams,
): DriveResult {
  m.replanTimer -= dt
  const goalMoved = !m.pathGoal || Math.hypot(goal.x - m.pathGoal.x, goal.y - m.pathGoal.y) > 110
  if (m.path.length === 0 || (goalMoved && m.replanTimer <= 0) || m.replanTimer < -3) {
    m.replanTimer = params.replanSeconds
    const route = nav.findPath({ x: m.x, y: m.y }, goal)
    m.pathGoal = { x: goal.x, y: goal.y }
    if (route && route.length > 0) m.path = route
    else {
      m.path = [{ x: goal.x, y: goal.y }]
      m.stuckCount += 1
      if (m.stuckCount >= 3) return 'unroutable'
    }
  }

  while (m.path.length > 1 && Math.hypot(m.path[0].x - m.x, m.path[0].y - m.y) < 34) m.path.shift()
  const wp = m.path[0]
  const dist = Math.hypot(wp.x - m.x, wp.y - m.y)
  if (m.path.length === 1 && dist < reach) {
    m.path = []
    coast(m, dt, params.accel)
    pushOut(m, obstacles, params.radius)
    return 'arrived'
  }
  const diff = turnToward(m, wp.x, wp.y, dt, params)
  const align = Math.max(0.3, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)))
  const arrive = m.path.length === 1 ? Math.min(1, dist / 120 + 0.25) : 1
  accelerate(m, maxSpeed * align * arrive, dt, params.accel)
  advance(m, dt)
  pushOut(m, obstacles, params.radius)

  // Stall detection: three checks in a row without moving means "stuck".
  m.stuckTimer += dt
  if (m.stuckTimer >= params.stuckCheckSeconds) {
    const moved = Math.hypot(m.x - m.stuckRef.x, m.y - m.stuckRef.y)
    m.stuckTimer = 0
    m.stuckRef = { x: m.x, y: m.y }
    if (moved >= params.stuckMinMove) m.stuckCount = 0
    else {
      m.stuckCount += 1
      if (m.stuckCount === 1) {
        m.path = []
        m.replanTimer = 0
      } else if (m.stuckCount === 2) {
        const free = nav.nearestFree(m.x, m.y)
        if (free) {
          m.x = free.x
          m.y = free.y
        }
        m.path = []
        m.replanTimer = 0
      } else return 'stalled'
    }
  }
  return 'moving'
}

/** Head straight for a nearby point (final approach to a floating item), easing off as it gets close. */
export function steerDirect(m: Mover, goal: Vec, dt: number, obstacles: readonly Circle[], maxSpeed: number, params: MotionParams): number {
  const dist = Math.hypot(goal.x - m.x, goal.y - m.y)
  const diff = turnToward(m, goal.x, goal.y, dt, params)
  const align = Math.max(0.25, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)))
  const ease = Math.min(1, dist / 90 + 0.3)
  accelerate(m, maxSpeed * 0.7 * align * ease, dt, params.accel)
  advance(m, dt)
  pushOut(m, obstacles, params.radius)
  return dist
}

/** Move to a safe spot and clear every route/stall record. Cargo and status are the caller's business. */
export function warp(m: Mover, spot: Vec): void {
  m.x = spot.x
  m.y = spot.y
  m.speed = 0
  resetRoute(m)
}
