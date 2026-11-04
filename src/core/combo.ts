/** Arcade combo: quick successive pickups raise a score multiplier. */
import { BALANCE } from '../config/balance'

export function multiplierForChain(chain: number): number {
  let mult = 1
  for (const tier of BALANCE.combo.tiers) {
    if (chain >= tier.minChain) mult = tier.multiplier
  }
  return mult
}

export class ComboTracker {
  chain = 0
  best = 0
  private lastTime = Number.NEGATIVE_INFINITY

  /** Register a pickup at game time `now` (seconds). Returns the new chain and multiplier. */
  register(now: number): { chain: number; multiplier: number } {
    this.expire(now)
    this.chain += 1
    this.best = Math.max(this.best, this.chain)
    this.lastTime = now
    return { chain: this.chain, multiplier: multiplierForChain(this.chain) }
  }

  /** Reset the chain if the window has lapsed. Returns true when a reset happened. */
  expire(now: number): boolean {
    if (this.chain > 0 && now - this.lastTime > BALANCE.combo.window) {
      this.chain = 0
      return true
    }
    return false
  }

  multiplier(): number {
    return multiplierForChain(this.chain)
  }

  /** 1 right after a pickup, falling to 0 as the window runs out. */
  remaining(now: number): number {
    if (this.chain === 0) return 0
    return Math.max(0, 1 - (now - this.lastTime) / BALANCE.combo.window)
  }

  reset(): void {
    this.chain = 0
    this.lastTime = Number.NEGATIVE_INFINITY
  }
}
