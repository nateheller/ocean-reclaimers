/** Window-level keyboard input (works regardless of canvas focus or scene pause state). */

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'KeyE', 'Escape', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Enter',
])

export class Input {
  private down = new Set<string>()
  private pressed = new Set<string>()
  /** Called on any key press; used to unlock audio and dismiss the title screen. */
  onAnyKey: ((code: string) => void) | null = null

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (GAME_KEYS.has(e.code)) e.preventDefault()
      if (!e.repeat) this.pressed.add(e.code)
      this.down.add(e.code)
      this.onAnyKey?.(e.code)
    })
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code)
    })
    window.addEventListener('blur', () => this.clear())
  }

  clear(): void {
    this.down.clear()
    this.pressed.clear()
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c))
  }

  /** True once per key press. */
  consume(code: string): boolean {
    return this.pressed.delete(code)
  }

  /** Drop queued presses (used when a menu opens). */
  flush(): void {
    this.pressed.clear()
  }

  throttle(): number {
    return (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0)
  }

  steer(): number {
    return (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0)
  }
}
