import Phaser from 'phaser'
import { GameScene } from './scenes/GameScene'
import { GameUI } from './ui/ui'
import './ui/ui.css'

const root = document.getElementById('game-root') as HTMLElement
const uiRoot = document.getElementById('ui') as HTMLElement

// Placeholder handlers; the scene installs the real ones when it is created.
const ui = new GameUI(uiRoot, {
  onPlay() {}, onContinue() {}, onNewGame() {}, onResume() {}, onMute() {}, onBuy() {}, onUndock() {}, onKeepSailing() {}, onSubmitScore() {}, onShowScores() {},
})

/** Render-resolution multiplier; lowered automatically on slow GPUs. */
let quality = 1
const dpr = () => Math.min(window.devicePixelRatio || 1, 2) * quality
const size = () => ({ w: Math.max(320, Math.floor(window.innerWidth * dpr())), h: Math.max(240, Math.floor(window.innerHeight * dpr())) })

const { w, h } = size()
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: root,
  width: w,
  height: h,
  backgroundColor: '#1b87b4',
  scale: { mode: Phaser.Scale.NONE },
  render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' },
  fps: { target: 60 },
  disableContextMenu: true,
  scene: [],
  callbacks: {
    preBoot: (g) => {
      g.registry.set('ui', ui)
    },
  },
})
game.scene.add('Game', GameScene, true)

const resize = () => {
  const s = size()
  game.scale.resize(s.w, s.h)
  const canvas = game.canvas
  if (canvas) {
    canvas.style.width = '100%'
    canvas.style.height = '100%'
  }
}
window.addEventListener('resize', resize)
resize()

// Adaptive resolution: if the game cannot hold ~40 fps, quietly render fewer pixels.
let slowTicks = 0
const bootTime = performance.now()
window.setInterval(() => {
  if (document.hidden || performance.now() - bootTime < 6000) return
  const fps = game.loop.actualFps
  if (fps > 0 && fps < 40) slowTicks++
  else slowTicks = 0
  if (slowTicks >= 4 && quality > 0.45) {
    quality = Math.max(0.45, quality * 0.8)
    slowTicks = 0
    resize()
  }
}, 1500)

// Handy for debugging in the console.
;(window as unknown as { __game: Phaser.Game }).__game = game
