/**
 * Screen-edge navigation aids (pure maths, no rendering).
 *
 * The station arrow and the sonar arrows all answer the same question: "this world point is off screen; where on the
 * edge of the screen should an arrow sit, and which way should it point?". Keeping the answer a pure function of the
 * camera view means it is identical at every resolution and camera position, and easy to test.
 */

export interface Point {
  x: number
  y: number
}

/** The part of the world the camera currently shows, in world pixels. */
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

/** The size of the on-screen overlay in CSS pixels. */
export interface ScreenSize {
  width: number
  height: number
}

/** Space reserved for HUD furniture: arrows are kept clear of it. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface EdgeIndicator {
  /** True when an arrow should be shown (the target is outside the clear part of the screen). */
  show: boolean
  /** Arrow position on screen (CSS px). */
  x: number
  y: number
  /** Direction from the screen centre toward the target, in radians (screen space, y down). */
  angle: number
  /** The target's own screen position (may be off screen). */
  screenX: number
  screenY: number
}

export interface EdgeOptions {
  /** The target counts as "clearly visible" once it is this many CSS px inside the screen edge. */
  clearMargin: number
  /** Extra distance it must be inside before a visible arrow is hidden again (prevents flicker at the boundary). */
  hysteresis?: number
  /** Whether the arrow was shown on the previous frame. */
  wasShown?: boolean
  /** Where arrows may sit. */
  insets: Insets
}

/** World point -> screen position for the given view. */
export function worldToScreen(p: Point, view: ViewRect, screen: ScreenSize): Point {
  return {
    x: ((p.x - view.x) / view.width) * screen.width,
    y: ((p.y - view.y) / view.height) * screen.height,
  }
}

/** True when `p` lies inside the screen rectangle shrunk by `margin` on every side. */
export function insideScreen(p: Point, screen: ScreenSize, margin: number): boolean {
  return p.x >= margin && p.x <= screen.width - margin && p.y >= margin && p.y <= screen.height - margin
}

export function edgeIndicator(target: Point, view: ViewRect, screen: ScreenSize, opts: EdgeOptions): EdgeIndicator {
  const s = worldToScreen(target, view, screen)
  const hysteresis = opts.hysteresis ?? 0
  // A shown arrow only hides once the target is *comfortably* inside; a hidden one appears the moment it leaves
  // the clear area. Together that gives a stable boundary without a distance cut-off.
  const margin = opts.wasShown ? opts.clearMargin + hysteresis : opts.clearMargin
  const clear = insideScreen(s, screen, margin)

  const cx = screen.width / 2
  const cy = screen.height / 2
  const dx = s.x - cx
  const dy = s.y - cy
  const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx)

  const left = opts.insets.left
  const right = screen.width - opts.insets.right
  const top = opts.insets.top
  const bottom = screen.height - opts.insets.bottom
  let tx = Infinity
  let ty = Infinity
  if (dx > 0) tx = (right - cx) / dx
  else if (dx < 0) tx = (left - cx) / dx
  if (dy > 0) ty = (bottom - cy) / dy
  else if (dy < 0) ty = (top - cy) / dy
  const t = Math.min(tx, ty, 1)
  return {
    show: !clear,
    x: cx + dx * t,
    y: cy + dy * t,
    angle,
    screenX: s.x,
    screenY: s.y,
  }
}

/** Metres shown to the player for a world distance in px (10 px = 1 m, matching the v0.2 readout). */
export function metres(distancePx: number): number {
  return Math.round(distancePx / 10)
}

/** Same scale as Station, with a positive whole-metre debris readout. */
export function debrisLabel(distancePx: number): string {
  return `Debris ${Math.max(1, metres(distancePx))} m`
}

/** Conservative label bounds, with padding; nearer targets get first choice of space. */
export function indicatorsOverlap(a: { x: number; y: number; width: number }, b: { x: number; y: number; width: number }): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 12 && Math.abs(a.y - b.y) < 60
}

/** Round a distance for display: exact when close, rounded to 50 m when far (and to a range when imprecise). */
export function roundedMetres(distancePx: number, step = 1): number {
  const m = distancePx / 10
  return Math.max(0, Math.round(m / step) * step)
}
