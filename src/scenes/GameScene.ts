import Phaser from 'phaser'
import { BALANCE, type DebrisType, type UpgradeId } from '../config/balance'
import {
  ISLANDS,
  PATCHES,
  REEFS,
  ROCKS,
  STATION_LAND,
  WORLD,
  type ZoneId,
} from '../config/world'
import {
  boatSpeed,
  boostCooldownFraction,
  boostReady,
  createBoat,
  distanceToDock,
  inCollectionZone,
  inDockRange,
  isBoosting,
  resolveCollisions,
  stepBoat,
  type BoatState,
} from '../core/boat'
import { alreadySubmitted, loadScores, markSubmitted, rankFor, STANDARD_BOARD, submitScore, topScores } from '../core/leaderboard'
import { GameModel } from '../core/model'
import { edgeIndicator, metres, type ViewRect } from '../core/navigation'
import { timeBandLabel } from '../core/scoring'
import { distanceLabel } from '../core/sensors'
import { TRAWLER_STATUS_LABEL, type TrawlerEvent } from '../core/trawler'
import { Rng, hashSeed } from '../core/rng'
import { buildSave, clearSave, loadSave, loadSettings, writeSave, writeSettings } from '../core/save'
import { TENDER_STATUS_LABEL, type TenderEvent } from '../core/tender'
import { UPGRADES, noUpgrades } from '../core/upgrades'
import { buildObstacles, generateDebris, islandPalms, zoneAt, type DebrisSpawn } from '../core/worldgen'
import { AudioEngine } from '../render/audio'
import { BoatView } from '../render/boatView'
import { Input } from '../render/input'
import { TENDER_STATUS_COLOR, TenderView } from '../render/tenderView'
import { TRAWLER_STATUS_COLOR, TrawlerView } from '../render/trawlerView'
import { TS, buildAllTextures } from '../render/textures'
import { Wildlife } from '../render/wildlife'
import { STATION_ART, bakeLandmass, bakeReef, bakeRock, bakeStation, buildDepthLayer } from '../render/worldart'
import { GameUI, type EdgeMarkerView } from '../ui/ui'

const D = {
  water: 0, caustic: 1, depth: 2, seabed: 3, wild: 4, murk: 5, land: 6, rock: 7, station: 8, ring: 8.5,
  debrisFoam: 9, debris: 10, wake: 11, boat: 12, palm: 13, fx: 14, text: 15, border: 16, dolphinJump: 12.5,
}

type Mode = 'title' | 'playing' | 'docked' | 'paused' | 'win'

interface DebrisView {
  spawn: DebrisSpawn
  img: Phaser.GameObjects.Image
  foam: Phaser.GameObjects.Image
  shadow: Phaser.GameObjects.Image
  phase: number
  cooldown: number
  baseScale: number
}

/** Murk opacity per cleanup level (0, 25, 50, 75%). */
const MURK_ALPHA = [0.58, 0.4, 0.22, 0]
const CAUSTIC_ALPHA = [0.2, 0.3, 0.42, 0.55]
const SEABED_ALPHA = [0.4, 0.6, 0.85, 1]

const MILESTONE_TEXT: Record<number, { title: string; sub: string }> = {
  0.25: { title: '25% cleaned', sub: 'The water is clearing and fish are returning' },
  0.5: { title: '50% cleaned', sub: 'Coral colors glow again - turtles and dolphins join in' },
  0.75: { title: '75% cleaned!', sub: 'Coral Bay sparkles - a manta ray and a whale have arrived' },
}

export class GameScene extends Phaser.Scene {
  private ui!: GameUI
  private audio = new AudioEngine()
  private input_ = new Input()
  private storage: Storage = window.localStorage

  private spawns: DebrisSpawn[] = []
  private model!: GameModel
  private boat: BoatState = createBoat()
  private obstacles = buildObstacles()
  private mode: Mode = 'title'
  private clock = 0
  private hasSave = false

  private waterBase!: Phaser.GameObjects.TileSprite
  private caustic!: Phaser.GameObjects.TileSprite
  private murk!: Phaser.GameObjects.TileSprite
  private seabed: Phaser.GameObjects.Image[] = []
  private murkAlpha = MURK_ALPHA[0]
  private causticAlpha = CAUSTIC_ALPHA[0]
  private seabedAlpha = SEABED_ALPHA[0]
  private clarityTween: Phaser.Tweens.Tween | null = null

  private boatView!: BoatView
  private wildlife!: Wildlife
  private views: DebrisView[] = []
  private dockRing!: Phaser.GameObjects.Image
  private tankGlow!: Phaser.GameObjects.Image
  private stationLabel!: Phaser.GameObjects.Text
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter
  private wake!: Phaser.GameObjects.Particles.ParticleEmitter
  private splash!: Phaser.GameObjects.Particles.ParticleEmitter
  private sparkle!: Phaser.GameObjects.Particles.ParticleEmitter
  private wakeAcc = 0

  private camPos = new Phaser.Math.Vector2()
  private look = new Phaser.Math.Vector2()
  private zoomBase = 1
  private zoomPunch = 0
  private zoomBoost = 1

  private lastZone: ZoneId | null = null
  private hintTimer = 0
  private saveTimer = 0
  private movedOnce = false
  private fullMsgCooldown = 0
  private lastCargoKey = ''
  private upgradeHinted = false
  private tenderView!: TenderView
  private trawlerView!: TrawlerView
  /** Counts down (in playing time) to showing the completion panel after the 75% celebration. */
  private pendingWinTimer = 0
  private homeShown = false
  private readonly arrowShown = new Map<string, boolean>()
  private sensorReading: ReturnType<GameModel['readSensors']> = { arrows: [], minimap: [] }
  private sensorTimer = 0
  private sonarTimer = 0
  private lastTrawlSfx = 0
  private tenderCalls = 0
  private lastDockUnload: { credits: number; items: number; units: number } | null = null
  private winShown = false
  private fontReady = false

  constructor() {
    super('Game')
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  create(): void {
    this.ui = this.registry.get('ui') as GameUI
    this.cameras.main.setBackgroundColor(0x1b87b4)
    buildAllTextures(this)

    this.spawns = generateDebris()
    this.model = new GameModel(this.spawns)

    this.buildWater()
    this.buildScenery()
    this.buildStation()
    this.buildBorder()
    this.buildDebris()
    this.buildEffects()

    this.boatView = new BoatView(this, D.boat)
    this.tenderView = new TenderView(this, D.boat - 0.3, D.text)
    this.tenderView.onWake = (x, y) => this.wake.emitParticleAt(x, y)
    this.trawlerView = new TrawlerView(this, D.boat - 0.35, D.text)
    this.trawlerView.onWake = (x, y) => this.wake.emitParticleAt(x, y)
    this.wildlife = new Wildlife(this, D.wild, D.dolphinJump)
    this.wildlife.onSplash = (x, y, big) => this.splashAt(x, y, big ? 14 : 6, true)

    this.setupUI()
    this.setupInput()
    this.loadProgress()

    const resize = () => this.onResize()
    this.scale.on('resize', resize)
    this.events.once('shutdown', () => this.scale.off('resize', resize))
    this.onResize()

    this.camPos.set(this.boat.x, this.boat.y)
    this.input_.flush()
    this.refreshAll()
    this.ui.setHudVisible(false)
    this.ui.showTitle(this.hasSave, this.model.progress)
    this.stationLabel.setVisible(false)
    const boot = document.getElementById('boot')
    if (boot) { boot.classList.add('done'); window.setTimeout(() => boot.remove(), 700) }
    this.mode = 'title'

    window.addEventListener('beforeunload', () => this.saveNow())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.saveNow()
        if (this.mode === 'playing') this.setPaused(true)
      }
    })
    window.addEventListener('blur', () => {
      if (this.mode === 'playing') this.setPaused(true)
    })
    ;(document as Document & { fonts?: FontFaceSet }).fonts?.load('700 20px Reclaimer').then(() => (this.fontReady = true), () => (this.fontReady = true))
  }

  private onResize(): void {
    const dpr = this.game.scale.width / Math.max(1, window.innerWidth)
    const cssH = window.innerHeight
    const fit = Phaser.Math.Clamp(cssH / 780, 0.78, 1.4)
    this.zoomBase = dpr * fit
  }

  private sprite(x: number, y: number, key: string, depth: number, scale = 1): Phaser.GameObjects.Image {
    return this.add.image(x, y, key).setScale(scale / TS).setDepth(depth)
  }

  private buildWater(): void {
    this.waterBase = this.add.tileSprite(0, 0, 100, 100, 'water_base').setOrigin(0).setDepth(D.water)
    this.caustic = this.add.tileSprite(0, 0, 100, 100, 'water_caustic').setOrigin(0).setDepth(D.caustic)
      .setBlendMode(Phaser.BlendModes.ADD).setTileScale(1.5, 1.5)
    this.murk = this.add.tileSprite(0, 0, 100, 100, 'murk').setOrigin(0).setDepth(D.murk).setTileScale(2, 2)
    buildDepthLayer(this, this.obstacles)
    this.add.image(0, 0, 'depth').setOrigin(0).setDisplaySize(WORLD.width, WORLD.height).setDepth(D.depth)
  }

  private buildScenery(): void {
    // Landmasses
    ISLANDS.forEach((isl) => {
      const circles = isl.lobes.map((l) => ({ x: isl.x + l.dx, y: isl.y + l.dy, r: l.r }))
      const baked = bakeLandmass(this, `isl_${isl.id}`, circles, hashSeed(WORLD.seed, 'island', isl.id))
      this.add.image(baked.x, baked.y, baked.key).setOrigin(0).setScale(1 / TS).setDepth(D.land)
      islandPalms(isl.id).forEach((p, i) => {
        const palm = this.sprite(p.x, p.y, 'palm', D.palm, 0.9 * p.scale).setRotation(p.rot)
        this.tweens.add({
          targets: palm, rotation: p.rot + 0.07, duration: 2200 + i * 170, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        })
      })
    })
    const land = bakeLandmass(this, 'land_station', STATION_LAND, hashSeed(WORLD.seed, 'station'))
    this.add.image(land.x, land.y, land.key).setOrigin(0).setScale(1 / TS).setDepth(D.land)

    ROCKS.forEach((r, i) => {
      const b = bakeRock(this, `rock_${i}`, r, hashSeed(WORLD.seed, 'rock', i))
      this.add.image(b.x, b.y, b.key).setOrigin(0).setScale(1 / TS).setDepth(D.rock)
    })
    REEFS.forEach((r, i) => {
      const b = bakeReef(this, `reef_${i}`, r, hashSeed(WORLD.seed, 'reef', i))
      this.add.image(b.x, b.y, b.key).setOrigin(0).setScale(1 / TS).setDepth(D.rock)
    })

    // Seabed coral visible through the water; it comes to life as the bay clears.
    const rng = new Rng(hashSeed(WORLD.seed, 'seabed'))
    const casters = this.obstacles.filter((o) => o.kind === 'island' || o.kind === 'reef')
    for (let i = 0; i < 170; i++) {
      const o = rng.pick(casters)
      const a = rng.range(0, Math.PI * 2)
      const d = o.r + rng.range(30, 190)
      const x = o.x + Math.cos(a) * d
      const y = o.y + Math.sin(a) * d
      if (x < 80 || y < 80 || x > WORLD.width - 80 || y > WORLD.height - 80) continue
      if (this.obstacles.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + 20)) continue
      const img = this.sprite(x, y, `coral_${rng.int(0, 5)}`, D.seabed, rng.range(0.7, 1.3)).setRotation(rng.range(0, 6.28))
      this.seabed.push(img)
    }
    this.applyClarity()
  }

  private buildStation(): void {
    const baked = bakeStation(this)
    this.add.image(baked.x, baked.y, baked.key).setOrigin(0).setScale(1 / TS).setDepth(D.station)
    void STATION_ART

    // Dock interaction ring
    this.dockRing = this.sprite(WORLD.dock.x, WORLD.dock.y, 'ring', D.ring, (BALANCE.station.interactRange * 2) / 128)
      .setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD)

    // Radar dish
    const radar = this.add.graphics({ x: 372, y: 3014 }).setDepth(D.station + 0.1)
    radar.lineStyle(3, 0x30404e, 1); radar.lineBetween(-15, 0, 15, 0)
    radar.lineStyle(3, 0xffffff, 1); radar.beginPath(); radar.arc(0, 0, 11, -1.1, 1.1); radar.strokePath()
    radar.fillStyle(0xff4a3d, 1); radar.fillCircle(0, 0, 3)
    this.tweens.add({ targets: radar, rotation: Math.PI * 2, duration: 4200, repeat: -1 })

    // Beacon
    const beacon = this.sprite(384, 3000, 'glow', D.station + 0.2, 0.5).setTint(0xff4a3d).setBlendMode(Phaser.BlendModes.ADD)
    this.tweens.add({ targets: beacon, alpha: { from: 0.2, to: 1 }, duration: 700, yoyo: true, repeat: -1 })

    // Flag
    const flag = this.add.graphics({ x: 438, y: 3004 }).setDepth(D.station + 0.2)
    flag.fillStyle(0xff6a4a, 1); flag.fillTriangle(0, -2, 22, 2, 0, 8)
    this.tweens.add({ targets: flag, scaleX: { from: 1, to: 0.65 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })

    // Tank glow (flashes while "processing" after an unload)
    this.tankGlow = this.sprite(228, 3040, 'glow', D.station + 0.3, 1.1).setTint(0x3ee6c1).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD)

    this.smoke = this.add.particles(228, 3040, 'foam', {
      frequency: 520, lifespan: 2600, speedY: { min: -26, max: -16 }, speedX: { min: 4, max: 14 },
      scale: { start: 0.3, end: 1.1 }, alpha: { start: 0.32, end: 0 }, tint: 0xeaf4f8,
    }).setDepth(D.palm)

    this.stationLabel = this.add.text(323, 2963, 'RECLAMATION STATION', {
      fontFamily: 'Reclaimer, Trebuchet MS, sans-serif', fontSize: '15px', color: '#ffffff', stroke: '#082a49', strokeThickness: 4,
    }).setOrigin(0.5).setResolution(3).setDepth(D.station + 0.4).setAlpha(0.95)
  }

  private buildBorder(): void {
    const edge = 0x0a2b57
    const big = 4000
    const rect = (x: number, y: number, w: number, h: number) =>
      this.add.rectangle(x, y, w, h, edge, 0.62).setOrigin(0).setDepth(D.border)
    rect(-big, -big, WORLD.width + big * 2, big)
    rect(-big, WORLD.height, WORLD.width + big * 2, big)
    rect(-big, 0, big, WORLD.height)
    rect(WORLD.width, 0, big, WORLD.height)
    // Rope of buoys along the edge
    const m = 30
    const g = this.add.graphics().setDepth(D.border + 0.1)
    g.lineStyle(2.5, 0xffffff, 0.55)
    g.strokeRect(m, m, WORLD.width - m * 2, WORLD.height - m * 2)
    const spacing = 160
    const buoy = (x: number, y: number, i: number) => {
      const b = this.sprite(x, y, 'buoy', D.border + 0.2, 1)
      this.tweens.add({ targets: b, y: y + 3, duration: 1400 + (i % 5) * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    }
    let i = 0
    for (let x = m; x <= WORLD.width - m; x += spacing) { buoy(x, m, i++); buoy(x, WORLD.height - m, i++) }
    for (let y = m + spacing; y < WORLD.height - m; y += spacing) { buoy(m, y, i++); buoy(WORLD.width - m, y, i++) }
  }

  private buildDebris(): void {
    for (const v of this.views) this.destroyView(v)
    this.views = []
    for (const s of this.spawns) {
      if (this.model.isRemoved(s.id)) continue
      this.views.push(this.makeView(s))
    }
  }

  private makeView(s: DebrisSpawn): DebrisView {
    const spec = BALANCE.debris[s.type]
    const k = s.type === 'net' ? 1.0 : s.type === 'container' ? 1.05 : 1.2
    const foamScale = (spec.radius * 4.2) / 32
    const shadow = this.sprite(s.x + 2, s.y + 4, 'blob', D.debrisFoam - 0.1, (spec.radius * 3.2) / 64 * TS / TS).setAlpha(0.7)
    const foam = this.sprite(s.x, s.y, 'foam', D.debrisFoam, foamScale).setAlpha(0.55)
    const img = this.sprite(s.x, s.y, s.type, D.debris, k).setRotation(s.rot)
    return { spawn: s, img, foam, shadow, phase: (s.id * 1.618) % 6.28, cooldown: 0, baseScale: k / TS }
  }

  private destroyView(v: DebrisView): void {
    v.img.destroy(); v.foam.destroy(); v.shadow.destroy()
  }

  private buildEffects(): void {
    this.wake = this.add.particles(0, 0, 'foam', {
      lifespan: { min: 600, max: 1100 }, scale: { start: 0.22, end: 0.95 }, alpha: { start: 0.55, end: 0 },
      speed: { min: 4, max: 20 }, frequency: -1,
    }).setDepth(D.wake)
    this.splash = this.add.particles(0, 0, 'drop', {
      lifespan: { min: 350, max: 650 }, speed: { min: 50, max: 170 }, scale: { start: 0.7, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xffffff, 0xbdf1ff, 0x8fe3ff], frequency: -1,
    }).setDepth(D.fx)
    this.sparkle = this.add.particles(0, 0, 'spark', {
      lifespan: { min: 600, max: 1200 }, speed: { min: 60, max: 260 }, scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 },
      rotate: { min: 0, max: 360 }, tint: [0xffe14a, 0xffffff, 0xff9ad0, 0x7cf2ff], frequency: -1,
    }).setDepth(D.fx)
  }

  // ===========================================================================
  // UI + input wiring
  // ===========================================================================

  private setupUI(): void {
    const settings = loadSettings(this.storage)
    this.audio.muted = settings.muted
    this.ui.setMuted(settings.muted)
    this.ui.onPauseRequest = () => {
      if (this.mode === 'playing') this.setPaused(true)
    }
    ;this.ui.setHandlers({
      onPlay: () => this.startGame(false),
      onContinue: () => this.startGame(true),
      onNewGame: () => this.newGame(),
      onResume: () => this.setPaused(false),
      onMute: () => this.toggleMute(),
      onBuy: (id: UpgradeId) => this.buyUpgrade(id),
      onUndock: () => this.undock(),
      onKeepSailing: () => this.keepSailing(),
      onSubmitScore: (name: string) => this.submitName(name),
      onShowScores: () => this.showScores(null),
    })
  }

  private setupInput(): void {
    this.input_.onAnyKey = (code) => {
      this.audio.unlock()
      if (this.mode === 'title' && (code === 'Enter' || code === 'Space') && !this.ui.scoresOpen) this.startGame(this.hasSave)
    }
    this.input.on('pointerdown', () => this.audio.unlock())
    window.addEventListener('pointerdown', () => this.audio.unlock())
  }

  private toggleMute(): void {
    this.audio.unlock()
    const muted = !this.audio.muted
    this.audio.setMuted(muted)
    this.ui.setMuted(muted)
    writeSettings(this.storage, { muted })
    if (!muted) this.audio.play('click')
  }

  private setPaused(paused: boolean): void {
    if (paused) {
      if (this.mode !== 'playing') return
      this.mode = 'paused'
      this.tweens.pauseAll()
      this.audio.setPaused(true)
      this.ui.showPause(true)
      this.saveNow()
    } else {
      if (this.mode !== 'paused') return
      this.mode = 'playing'
      this.tweens.resumeAll()
      this.audio.setPaused(false)
      this.ui.showPause(false)
      this.input_.flush()
    }
  }

  // ===========================================================================
  // Game flow
  // ===========================================================================

  private loadProgress(): void {
    const ids = new Set(this.spawns.map((s) => s.id))
    const save = loadSave(this.storage, ids)
    this.hasSave = !!save && (save.model.removed.length > 0 || save.model.credits > 0 || save.model.unloads > 0 || Object.values(save.model.upgrades).some(Boolean))
    this.wildlife.ensureTier(0, true)
    if (save) this.applySave(save)
  }

  private applySave(save: NonNullable<ReturnType<typeof loadSave>>): void {
    this.model.restore(save.model)
    this.boat = createBoat(save.boat.x, save.boat.y, save.boat.heading)
    resolveCollisions(this.boat, this.obstacles)
    this.buildDebris()
    const level = this.model.milestones.size
    this.murkAlpha = MURK_ALPHA[level]
    this.causticAlpha = CAUSTIC_ALPHA[level]
    this.seabedAlpha = SEABED_ALPHA[level]
    this.applyClarity()
    this.wildlife.ensureTier(level, true)
    // A finished expedition whose score was never saved or declined offers the entry form again.
    this.winShown = this.model.completed && this.model.completion?.entry !== 'pending'
    this.syncTenders(false)
    this.syncTrawlers(false)
  }

  private startGame(continueSave: boolean): void {
    if (this.mode !== 'title') return
    this.audio.unlock()
    if (!continueSave) this.resetWorld(false)
    this.ui.hideTitle()
    this.ui.setHudVisible(true)
    this.stationLabel.setVisible(true)
    if (continueSave) this.movedOnce = true
    if (continueSave && this.model.completion?.entry === 'pending') this.pendingWinTimer = 1.4
    this.mode = 'playing'
    this.input_.flush()
    this.audio.play('dock')
    this.lastZone = null
    this.refreshAll()
  }

  private newGame(): void {
    this.audio.unlock()
    this.autoSubmitPending()
    clearSave(this.storage)
    this.hasSave = false
    this.tweens.resumeAll()
    this.audio.setPaused(false)
    this.resetWorld(true)
    this.ui.showPause(false)
    this.ui.hideWin()
    this.ui.hideScores()
    this.ui.hideDock()
    this.ui.hideTitle()
    this.ui.setHudVisible(true)
    this.stationLabel.setVisible(true)
    this.mode = 'playing'
    this.input_.flush()
    this.lastZone = null
    this.refreshAll()
  }

  private resetWorld(announce: boolean): void {
    this.model = new GameModel(this.spawns)
    this.boat = createBoat()
    this.camPos.set(this.boat.x, this.boat.y)
    this.buildDebris()
    this.wildlife.reset()
    this.wildlife.ensureTier(0, true)
    this.murkAlpha = MURK_ALPHA[0]
    this.causticAlpha = CAUSTIC_ALPHA[0]
    this.seabedAlpha = SEABED_ALPHA[0]
    this.applyClarity()
    this.clock = 0
    this.winShown = false
    this.movedOnce = false
    this.upgradeHinted = false
    this.lastCargoKey = ''
    this.tenderCalls = 0
    this.tenderView.clear()
    this.ui.setTenders([])
    this.trawlerView.clear()
    this.ui.setTrawlers([])
    this.pendingWinTimer = 0
    this.homeShown = false
    this.arrowShown.clear()
    this.sensorReading = { arrows: [], minimap: [] }
    this.sonarTimer = 0
    this.ui.setEdgeMarkers([])
    this.ui.minimap.setExpanded(false)
    if (announce) this.ui.toast('Fresh start', 'Coral Bay is waiting')
  }

  private keepSailing(): void {
    this.autoSubmitPending()
    this.ui.hideWin()
    this.mode = 'playing'
    this.input_.flush()
    this.saveNow()
  }

  private saveNow(): void {
    if (this.mode === 'title' && !this.hasSave) return
    writeSave(this.storage, buildSave(this.model, this.boat))
  }

  // ===========================================================================
  // Docking, unloading, upgrades
  // ===========================================================================

  private dock(): void {
    const result = this.model.unload()
    this.lastDockUnload = { credits: result.credits, items: result.items, units: result.units }
    this.mode = 'docked'
    this.audio.play('dock')
    if (result.items > 0) {
      this.audio.play('unload')
      this.flyCoins(result.credits)
      this.pulseStation()
    }
    this.ui.setCredits(this.model.credits)
    this.refreshCargo(true)
    this.ui.showDock(this.dockData())
    this.ui.setPrompt(null)
    this.ui.setHint(null)
    this.input_.flush()
    this.saveNow()
  }

  private undock(): void {
    if (this.mode !== 'docked') return
    this.mode = 'playing'
    this.ui.hideDock()
    this.audio.play('click')
    this.input_.flush()
    this.saveNow()
  }

  private dockData() {
    return { credits: this.model.credits, levels: { ...this.model.upgrades }, unloads: this.model.unloads, unloaded: this.lastDockUnload }
  }

  private buyUpgrade(id: UpgradeId): void {
    if (this.mode !== 'docked') return
    const result = this.model.buy(id)
    if (!result.ok) {
      this.audio.play('denied')
      this.ui.shakeUpgrade(id)
      return
    }
    this.audio.play('upgrade', result.level)
    this.boatView.setUpgrades(this.model.upgrades, true)
    this.boatView.setCargo(this.model.cargo, this.model.capacity)
    this.ui.setCredits(this.model.credits)
    this.refreshCargo(true)
    this.lastDockUnload = this.lastDockUnload
    this.ui.renderDock(this.dockData())
    this.ui.flashUpgrade(id)
    this.sparkle.explode(26, this.boat.x, this.boat.y)
    const ring = this.sprite(this.boat.x, this.boat.y, 'ring', D.fx, 0.4).setAlpha(0.9).setTint(0xffe14a)
    this.tweens.add({ targets: ring, scale: 1.6 / TS * 2, alpha: 0, duration: 700, onComplete: () => ring.destroy() })
    const def = UPGRADES[id]
    const maxed = result.level >= def.maxLevel
    this.floatText(this.boat.x, this.boat.y - 40, `${def.name}${def.maxLevel > 1 ? ` ${result.level}` : ''}`, '#ffe14a', 22)
    this.floatText(this.boat.x, this.boat.y - 12, maxed && def.maxLevel > 1 ? 'MAX!' : def.effect(result.level), '#ffffff', 17)
    if (maxed && def.maxLevel > 1) this.ui.pop(`${def.name.toUpperCase()} MAXED`, 'pink')
    this.syncTenders(true)
    this.syncTrawlers(true)
    if (id === 'sonar') this.sonarPing(true)
    this.cameras.main.flash(180, 255, 245, 200, true)
    this.saveNow()
  }

  // ===========================================================================
  // Sonar
  // ===========================================================================

  /** An expanding ring around the boat (and a quiet ping). Purely visual: the markers come from the sensor reading. */
  private sonarPing(loud: boolean): void {
    const level = this.model.upgrades.sonar
    if (level <= 0) return
    const R = Math.min(1500, 520 + level * 200)
    const ring = this.sprite(this.boat.x, this.boat.y, 'ring', D.fx, 0.5).setAlpha(loud ? 0.8 : 0.4).setTint(0x3ee6c1)
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: loud ? 1800 : 2600,
      ease: 'Sine.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        ring.setPosition(this.boat.x, this.boat.y)
        ring.setScale(Phaser.Math.Linear(0.5, R / 128, t))
        ring.setAlpha((loud ? 0.8 : 0.4) * (1 - t))
      },
      onComplete: () => ring.destroy(),
    })
    this.audio.play('sonar', level)
  }

  // ===========================================================================
  // Auto trawlers
  // ===========================================================================

  /** Make the trawler views match the fleet; brand-new trawlers get a launch effect when `announce` is set. */
  private syncTrawlers(announce: boolean): void {
    const created = this.trawlerView.sync(this.model.trawlers.trawlers)
    this.trawlerView.update(this.model.trawlers.trawlers, this.time.now, 0)
    this.updateTrawlerChips()
    if (!announce) return
    for (const id of created) {
      const pos = this.trawlerView.getPosition(id)
      if (!pos) continue
      this.splashAt(pos.x, pos.y, 16, true)
      this.sparkle.explode(20, pos.x, pos.y)
      this.floatText(pos.x, pos.y - 34, 'Auto Trawler launched!', '#c59bff', 20)
      this.audio.play('trawlerLaunch')
    }
  }

  private runTrawlers(dt: number): void {
    if (this.model.trawlers.count === 0) return
    const { events, newMilestones } = this.model.updateTrawlers(dt, this.boat)
    if (events.length) this.handleTrawlerEvents(events)
    this.trawlerView.update(this.model.trawlers.trawlers, this.time.now, dt)
    this.updateTrawlerChips()
    if (newMilestones.length) {
      this.ui.setProgress(this.model.progress)
      for (const m of newMilestones) this.onMilestone(m)
    }
  }

  private updateTrawlerChips(): void {
    const cap = this.model.trawlerStats.capacity
    this.ui.setTrawlers(
      this.model.trawlers.trawlers.map((t, slot) => {
        const units = t.cargo.bottle + t.cargo.container * 2 + t.cargo.net * 4
        return { slot, label: TRAWLER_STATUS_LABEL[t.status], color: TRAWLER_STATUS_COLOR[t.status], load: units > 0 ? `${units}/${cap}` : '' }
      }),
    )
  }

  private handleTrawlerEvents(events: readonly TrawlerEvent[]): void {
    for (const e of events) {
      if (e.type === 'collected') {
        const i = this.views.findIndex((v) => v.spawn.id === e.spawn.id)
        if (i >= 0) {
          const [v] = this.views.splice(i, 1)
          this.suckIntoTrawler(v, e.trawler.id)
        }
        this.trawlerView.scoop(e.trawler.id)
        this.splashAt(e.spawn.x, e.spawn.y, e.spawn.type === 'net' ? 10 : 5, false)
        const now = performance.now()
        if (now - this.lastTrawlSfx > 140) {
          this.lastTrawlSfx = now
          this.audio.play('trawl', e.trawler.collected)
        }
        this.ui.setProgress(this.model.progress)
        this.saveTimer = Math.min(this.saveTimer, BALANCE.save.autosaveSeconds - 1.5)
      } else if (e.type === 'delivered') {
        this.audio.play('deliver')
        this.audio.play('coin', 3)
        this.floatText(330, 3020, `+${e.credits}`, '#d9c6ff', 26)
        this.pulseStation()
        this.ui.setCredits(this.model.credits)
        this.ui.notice(`Trawler A${this.model.trawlers.trawlers.indexOf(e.trawler) + 1} delivered ${e.units} units  +${e.credits}`, 'good')
        if (this.ui.dockOpen) this.ui.renderDock(this.dockData())
        this.saveNow()
      }
    }
  }

  /** The scooped item is pulled into the trawler's hopper (following the moving hull) and shrinks away. */
  private suckIntoTrawler(v: DebrisView, trawlerId: number): void {
    v.foam.destroy()
    v.shadow.destroy()
    const sx = v.img.x
    const sy = v.img.y
    const s0 = v.baseScale
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 320,
      ease: 'Cubic.easeIn',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        const pos = this.trawlerView.getPosition(trawlerId) ?? { x: sx, y: sy }
        v.img.setPosition(Phaser.Math.Linear(sx, pos.x, t), Phaser.Math.Linear(sy, pos.y, t))
        v.img.setScale(s0 * (1 + Math.sin(t * Math.PI) * 0.2) * (1 - t * 0.8))
        v.img.setRotation(v.img.rotation + 0.2)
        v.img.setAlpha(1 - t * 0.7)
      },
      onComplete: () => v.img.destroy(),
    })
    const ring = this.sprite(sx, sy, 'ring', D.fx, 0.18).setAlpha(0.7).setTint(0xc59bff)
    this.tweens.add({ targets: ring, scale: 0.7, alpha: 0, duration: 480, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() })
  }

  // ===========================================================================
  // Cargo tenders
  // ===========================================================================
  /** Make the tender views match the fleet. `announce` plays a launch effect for brand-new tenders. */
  private syncTenders(announce: boolean): void {
    const created = this.tenderView.sync(this.model.fleet.tenders)
    this.tenderView.update(this.model.fleet.tenders, this.time.now, 0)
    this.updateTenderChips()
    if (!announce) return
    for (const id of created) {
      const pos = this.tenderView.getPosition(id)
      if (!pos) continue
      this.splashAt(pos.x, pos.y, 14, true)
      this.sparkle.explode(18, pos.x, pos.y)
      this.floatText(pos.x, pos.y - 30, 'Tender launched!', '#6cf0c1', 20)
    }
  }

  private runFleet(dt: number): void {
    if (this.model.fleet.count === 0) return
    const events = this.model.updateFleet(dt, this.boat)
    if (events.length) this.handleTenderEvents(events)
    this.tenderView.update(this.model.fleet.tenders, this.time.now, dt)
    this.updateTenderChips()
  }

  private updateTenderChips(): void {
    const cap = this.model.tenderStats.capacity
    this.ui.setTenders(
      this.model.fleet.tenders.map((t, slot) => {
        const units = t.cargo.bottle + t.cargo.container * 2 + t.cargo.net * 4
        return {
          slot,
          label: TENDER_STATUS_LABEL[t.status],
          color: TENDER_STATUS_COLOR[t.status],
          load: units > 0 ? `${units}/${cap}` : '',
        }
      }),
    )
  }

  private callTender(): void {
    const { result, events } = this.model.requestTender(this.boat)
    if (!result.ok) {
      this.audio.play('denied')
      const text =
        result.reason === 'none'
          ? 'Buy a Cargo Tender at the station first'
          : result.reason === 'empty'
            ? 'Your hold is empty - collect some plastic first'
            : result.reason === 'claimed'
              ? 'A tender is already on its way for this cargo'
              : 'All tenders are busy'
      this.ui.notice(text, 'warn')
      return
    }
    this.tenderCalls += 1
    this.audio.play('request')
    const slot = this.model.fleet.tenders.indexOf(result.tender) + 1
    this.ui.notice(`Tender T${slot} on its way`, 'good')
    const ring = this.sprite(this.boat.x, this.boat.y, 'ring', D.fx, 0.3).setAlpha(0.9).setTint(0x6cf0c1)
    this.tweens.add({ targets: ring, scale: 1.5 / TS * 2, alpha: 0, duration: 650, onComplete: () => ring.destroy() })
    this.handleTenderEvents(events)
  }

  private handleTenderEvents(events: readonly TenderEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'dispatched':
          if (e.auto) {
            this.audio.play('request')
            this.ui.notice('Tender dispatched automatically', 'good')
          }
          break
        case 'loaded': {
          this.audio.play('transfer')
          this.flyCrates(e.tender.x, e.tender.y, e.counts)
          this.floatText(e.tender.x, e.tender.y - 46, `Loaded ${e.units}`, '#ffe14a', 18)
          this.boatView.setCargo(this.model.cargo, this.model.capacity)
          this.refreshCargo(true)
          this.saveTimer = Math.min(this.saveTimer, BALANCE.save.autosaveSeconds - 1.5)
          break
        }
        case 'nothingToCarry':
          this.ui.notice('Tender returned - your hold was already empty', 'warn')
          break
        case 'delivered': {
          this.audio.play('deliver')
          this.audio.play('coin', 2)
          this.floatText(330, 3020, `+${e.credits}`, '#ffe14a', 26)
          this.pulseStation()
          this.ui.setCredits(this.model.credits)
          this.ui.notice(`Tender delivered ${e.units} units  +${e.credits}`, 'good')
          if (this.ui.dockOpen) this.ui.renderDock(this.dockData())
          this.saveNow()
          break
        }
        default:
          break
      }
    }
  }

  /** A short hop of small crates from the player's boat to the tender. */
  private flyCrates(tx: number, ty: number, counts: { bottle: number; container: number; net: number }): void {
    const colors: number[] = []
    for (let i = 0; i < counts.net; i++) colors.push(0x8fe05a)
    for (let i = 0; i < counts.container; i++) colors.push(0xff9b2e)
    for (let i = 0; i < counts.bottle; i++) colors.push(0x6cc7ff)
    const n = Math.min(8, colors.length)
    for (let i = 0; i < n; i++) {
      const crate = this.add.rectangle(this.boat.x, this.boat.y, 9, 9, colors[Math.floor((i * colors.length) / n)]).setDepth(D.fx).setStrokeStyle(1.5, 0xffffff, 0.8)
      const sx = this.boat.x
      const sy = this.boat.y
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 340,
        delay: i * 55,
        ease: 'Sine.easeInOut',
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0
          crate.setPosition(Phaser.Math.Linear(sx, tx, t), Phaser.Math.Linear(sy, ty, t) - Math.sin(t * Math.PI) * 34)
          crate.setRotation(t * 5)
        },
        onComplete: () => {
          crate.destroy()
          this.splash.explode(2, tx, ty)
        },
      })
    }
  }

  private flyCoins(credits: number): void {
    const n = Math.min(14, Math.max(3, Math.round(credits / 4)))
    const tx = 330
    const ty = 3050
    for (let i = 0; i < n; i++) {
      const coin = this.sprite(this.boat.x, this.boat.y, 'coin', D.fx, 1).setAlpha(0)
      const sx = this.boat.x + Phaser.Math.Between(-16, 16)
      const sy = this.boat.y + Phaser.Math.Between(-16, 16)
      this.tweens.addCounter({
        from: 0, to: 1, duration: 650, delay: i * 50, ease: 'Sine.easeIn',
        onStart: () => coin.setAlpha(1),
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0
          coin.setPosition(Phaser.Math.Linear(sx, tx, t), Phaser.Math.Linear(sy, ty, t) - Math.sin(t * Math.PI) * 70)
          coin.setScale((1 - t * 0.5) / TS * 1.0)
          coin.setRotation(t * 8)
        },
        onComplete: () => {
          coin.destroy()
          this.audio.play('coin', i)
        },
      })
    }
  }

  private pulseStation(): void {
    this.tankGlow.setAlpha(0)
    this.tweens.add({ targets: this.tankGlow, alpha: { from: 0.9, to: 0 }, duration: 1600, ease: 'Sine.easeOut' })
    this.smoke.explode(7)
  }

  // ===========================================================================
  // Collection
  // ===========================================================================

  private handleCollection(): void {
    const stats = this.model.stats
    const bow = {
      x: this.boat.x + Math.cos(this.boat.heading) * (BALANCE.boat.radius + stats.zoneLength * 0.6),
      y: this.boat.y + Math.sin(this.boat.heading) * (BALANCE.boat.radius + stats.zoneLength * 0.6),
    }
    for (let i = this.views.length - 1; i >= 0; i--) {
      const v = this.views[i]
      const spec = BALANCE.debris[v.spawn.type]
      if (Math.abs(v.spawn.x - this.boat.x) > 220 || Math.abs(v.spawn.y - this.boat.y) > 220) continue
      if (!inCollectionZone(this.boat, v.spawn.x, v.spawn.y, spec.radius, stats)) continue
      const res = this.model.collect(v.spawn.id, this.clock)
      if (!res.ok) {
        if (res.reason === 'full' && v.cooldown <= 0) this.rejectDebris(v)
        continue
      }
      this.views.splice(i, 1)
      this.onCollected(v, res, bow)
    }
  }

  private rejectDebris(v: DebrisView): void {
    v.cooldown = 1.6
    this.tweens.add({ targets: v.img, angle: v.img.angle + 18, duration: 90, yoyo: true, repeat: 1 })
    if (this.fullMsgCooldown <= 0) {
      this.fullMsgCooldown = 1.4
      const free = this.model.cargoFree
      const need = BALANCE.debris[v.spawn.type].cargo
      this.floatText(this.boat.x, this.boat.y - 44, free === 0 ? 'Hold full!' : `Needs ${need} space`, '#ff9a8a', 24)
      this.ui.flashFull()
      this.audio.play('full')
    }
  }

  private onCollected(v: DebrisView, res: Extract<ReturnType<GameModel['collect']>, { ok: true }>, bow: { x: number; y: number }): void {
    const type = v.spawn.type as DebrisType
    const x = v.spawn.x
    const y = v.spawn.y

    // Suck the item into the bow.
    v.foam.destroy(); v.shadow.destroy()
    const sx = v.img.x, sy = v.img.y, s0 = v.baseScale
    this.tweens.addCounter({
      from: 0, to: 1, duration: 230, ease: 'Cubic.easeIn',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        const tx = this.boat.x + Math.cos(this.boat.heading) * 24
        const ty = this.boat.y + Math.sin(this.boat.heading) * 24
        v.img.setPosition(Phaser.Math.Linear(sx, tx, t), Phaser.Math.Linear(sy, ty, t))
        v.img.setScale(s0 * (1 + Math.sin(t * Math.PI) * 0.25) * (1 - t * 0.75))
        v.img.setRotation(v.img.rotation + 0.25)
        v.img.setAlpha(1 - t * 0.6)
      },
      onComplete: () => v.img.destroy(),
    })

    // Splash + ripple + score pop
    this.splashAt(x, y, type === 'net' ? 18 : type === 'container' ? 11 : 7, false)
    const ring = this.sprite(x, y, 'ring', D.fx, 0.2).setAlpha(0.85)
    this.tweens.add({ targets: ring, scale: (BALANCE.debris[type].radius * 0.07 + 0.35) * 2 / TS * 1.0, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() })
    const boosted = res.multiplier > 1
    this.floatText(
      x, y - 12,
      boosted ? `+${res.scoreGained}  \u00d7${res.multiplier.toFixed(1)}` : `+${res.scoreGained}`,
      boosted ? '#ff9ad0' : '#ffffff',
      boosted ? 24 : 20,
    )

    // Audio: pentatonic ladder rises with the chain.
    this.audio.play('collect', res.chain)
    if (type === 'net') this.audio.play('net')
    if ([3, 5, 10].includes(res.chain)) {
      const tier = res.chain === 3 ? 0 : res.chain === 5 ? 4 : 7
      this.audio.play('combo', tier)
      this.ui.pop(`COMBO \u00d7${res.multiplier.toFixed(1)}`, 'pink')
      this.sparkle.explode(16, this.boat.x, this.boat.y)
      this.zoomPunch = 0.03
    }
    if (type === 'net') this.zoomPunch = Math.max(this.zoomPunch, 0.02)

    // HUD + hold + save
    this.boatView.setCargo(this.model.cargo, this.model.capacity)
    this.refreshCargo(true)
    this.ui.setProgress(this.model.progress)
    this.ui.setScore(this.model.score)
    this.saveTimer = Math.min(this.saveTimer, BALANCE.save.autosaveSeconds - 1.5)

    for (const m of res.newMilestones) this.onMilestone(m)
    void bow
  }

  private onMilestone(m: number): void {
    const level = (BALANCE.progress.milestones as readonly number[]).indexOf(m) + 1
    this.audio.play('milestone')
    const text = MILESTONE_TEXT[m] ?? { title: `${Math.round(m * 100)}% cleaned`, sub: '' }
    this.ui.toast(text.title, text.sub, 'milestone')
    this.setClarity(level)
    this.wildlife.ensureTier(level, false)
    const cam = this.cameras.main
    this.sparkle.explode(46, cam.midPoint.x, cam.midPoint.y)
    this.sparkle.explode(30, this.boat.x, this.boat.y)
    cam.flash(300, 200, 255, 245, true)
    if (m >= BALANCE.progress.completion && !this.winShown) {
      this.winShown = true
      // Give the celebration a moment, then show the result. The countdown only runs while playing, so it never
      // opens over the shop or the pause menu.
      this.pendingWinTimer = 3.2
    }
    this.saveNow()
  }

  // ===========================================================================
  // Completion and high scores
  // ===========================================================================

  private showCompletion(): void {
    const c = this.model.completion
    if (!c || this.mode !== 'playing') return
    const store = loadScores(this.storage)
    const { rank, qualifies } = rankFor(store, c.finalScore)
    const board = topScores(store)
    const size = BALANCE.scoring.leaderboardSize
    const duplicate = alreadySubmitted(store, c.runId)
    const canEnter = c.entry === 'pending' && qualifies && !duplicate
    if (!canEnter && c.entry === 'pending') {
      // Nothing to enter: remember that this run was evaluated so it is never offered again.
      c.entry = duplicate ? 'saved' : 'skipped'
      markSubmitted(this.storage, c.runId)
      this.saveNow()
    }
    this.mode = 'win'
    this.ui.setPrompt(null)
    this.ui.minimap.setExpanded(false)
    this.ui.showWin({
      timeSeconds: c.timeSeconds,
      bandLabel: timeBandLabel(c.timeSeconds),
      baseScore: c.baseScore,
      multiplier: c.multiplier,
      finalScore: c.finalScore,
      credits: this.model.credits,
      bestChain: c.bestChain,
      qualifies: canEnter,
      rank,
      threshold: board.length >= size ? board[board.length - 1].finalScore + 1 : 0,
      defaultName: store.lastName || 'CAPTAIN',
      nameMaxLength: BALANCE.scoring.nameMaxLength,
      note: duplicate ? 'This expedition is already on the leaderboard.' : undefined,
    })
  }

  private submitName(name: string): void {
    const c = this.model.completion
    if (!c || c.entry !== 'pending') return
    const res = submitScore(this.storage, { completion: c, name })
    if (res.ok) {
      c.entry = 'saved'
      this.saveNow()
      this.audio.play('scoreSaved')
      this.ui.showScoreSaved({
        rank: res.rank,
        name: res.entry.name,
        entryId: res.entry.id,
        newPersonalBest: res.newPersonalBest,
        previousBest: res.previousBest,
        improvement: res.improvement,
        entries: res.entries,
      })
      this.showScores(res.entry.id)
    } else if (res.reason === 'duplicate') {
      c.entry = 'saved'
      this.ui.showScoreError('This expedition is already on the leaderboard.')
    } else if (res.reason === 'not-qualified') {
      c.entry = 'skipped'
      this.ui.showScoreError('That score no longer makes the top 10.')
    } else {
      this.ui.showScoreError('Scores could not be saved on this device (browser storage is unavailable).')
    }
  }

  /** Save a score that is still waiting for a name (Keep Sailing / New Game never lose a qualifying score). */
  private autoSubmitPending(): void {
    const c = this.model.completion
    if (!c || c.entry !== 'pending' || this.mode !== 'win') return
    const typed = this.ui.currentName()
    if (typed === null) return
    const store = loadScores(this.storage)
    if (!rankFor(store, c.finalScore).qualifies) return
    submitScore(this.storage, { completion: c, name: typed || store.lastName || 'CAPTAIN' })
    c.entry = 'saved'
  }

  private showScores(highlightId: string | null): void {
    const store = loadScores(this.storage)
    this.ui.showScores({ title: 'Coral Bay \u2013 Standard run', entries: topScores(store, STANDARD_BOARD), highlightId })
  }

  private setClarity(level: number): void {
    this.clarityTween?.stop()
    const from = { m: this.murkAlpha, c: this.causticAlpha, s: this.seabedAlpha }
    this.clarityTween = this.tweens.addCounter({
      from: 0, to: 1, duration: 4000, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0
        this.murkAlpha = Phaser.Math.Linear(from.m, MURK_ALPHA[level], t)
        this.causticAlpha = Phaser.Math.Linear(from.c, CAUSTIC_ALPHA[level], t)
        this.seabedAlpha = Phaser.Math.Linear(from.s, SEABED_ALPHA[level], t)
        this.applyClarity()
      },
    })
  }

  private applyClarity(): void {
    this.murk?.setAlpha(this.murkAlpha).setVisible(this.murkAlpha > 0.005)
    this.caustic?.setAlpha(this.causticAlpha)
    for (const c of this.seabed) c.setAlpha(this.seabedAlpha)
  }

  // ===========================================================================
  // Effects helpers
  // ===========================================================================

  private splashAt(x: number, y: number, count: number, big: boolean): void {
    this.splash.explode(count, x, y)
    if (big) {
      const ring = this.sprite(x, y, 'ring', D.fx, 0.3).setAlpha(0.8)
      this.tweens.add({ targets: ring, scale: 1.4 / TS * 2, alpha: 0, duration: 900, onComplete: () => ring.destroy() })
    }
  }

  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Reclaimer, Trebuchet MS, sans-serif', fontSize: `${size}px`, fontStyle: 'bold', color,
      stroke: '#082a49', strokeThickness: 5,
    }).setOrigin(0.5).setResolution(Math.max(2, Math.ceil(this.zoomBase * 1.2))).setDepth(D.text).setScale(0.6)
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' })
    this.tweens.add({ targets: t, y: y - 46, alpha: 0, delay: 350, duration: 650, ease: 'Sine.easeIn', onComplete: () => t.destroy() })
  }

  // ===========================================================================
  // HUD refresh
  // ===========================================================================

  private refreshCargo(bump: boolean): void {
    this.ui.setCargo(this.model.cargoUsed, this.model.capacity)
    this.boatView.setFull(this.model.cargoFree === 0)
    if (bump) this.ui.bumpCargo()
  }

  private refreshAll(): void {
    this.ui.setCredits(this.model.credits, false)
    this.ui.setScore(this.model.score)
    this.ui.setProgress(this.model.progress)
    this.ui.setMuted(this.audio.muted)
    this.boatView.setUpgrades(this.model.upgrades)
    this.boatView.setCargo(this.model.cargo, this.model.capacity)
    this.refreshCargo(false)
    this.syncTenders(false)
    this.syncTrawlers(false)
  }

  private updateHints(): void {
    if (this.mode !== 'playing') {
      this.ui.setHint(null)
      return
    }
    const m = this.model
    const used = m.cargoUsed / m.capacity
    let hint: string | null = null
    if (!this.movedOnce) hint = 'Press <b>W</b> to sail and <b>A</b> / <b>D</b> to steer'
    else if (m.removed.size === 0) hint = 'Sail into the floating plastic to scoop it up'
    else if (this.tenderCalls < 3 && m.fleet.tenders.some((t) => t.status === 'idle') && used >= (m.cargoFree === 0 ? 0 : 0.5)) {
      hint = m.cargoFree === 0 ? 'Hold full! Press <b>R</b> to call a cargo tender' : 'Press <b>R</b> to send a cargo tender to take your cargo'
    } else if (m.cargoFree === 0) hint = 'Hold full! Head back to the station'
    else if (used >= 0.7 && m.unloads === 0) hint = 'Hold filling up - bring it to the station to earn credits'
    else if (m.unloads > 0 && !this.upgradeHinted && m.upgrades.cargo + m.upgrades.engine + m.upgrades.width === 0 && m.credits >= UPGRADES.cargo.cost(1)) {
      hint = 'You can afford an upgrade - visit the station'
    } else if (m.unloads === 0 && m.removed.size >= 1 && m.removed.size < 4) hint = 'Collect more plastic - chain pickups for combo score'
    this.ui.setHint(hint)
  }

  // ===========================================================================
  // Main loop
  // ===========================================================================

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05)
    const cam = this.cameras.main
    this.updateWater(time, cam)

    // Escape / mute are always live.
    if (this.input_.consume('KeyM')) this.toggleMute()
    this.handleMenuKeys()

    const active = this.mode === 'playing' || this.mode === 'docked'
    if (this.mode === 'paused') {
      this.updateCamera(dt, true)
      return
    }

    this.wildlife.update(dt, time, this.boat.x, this.boat.y)
    this.updateDebrisViews(time, dt)

    if (this.mode === 'title') {
      this.boatView.update(this.boat.x, this.boat.y, this.boat.heading, time, 0, false, 0)
      this.updateCamera(dt, false)
      return
    }

    if (this.mode === 'win') {
      this.ui.setPrompt(null)
      this.stepBoatPhysics(dt, { throttle: 0, steer: 0, boost: false })
      this.runFleet(dt)
      this.runTrawlers(dt)
      this.updateCamera(dt, false)
      return
    }

    if (active) {
      this.fullMsgCooldown = Math.max(0, this.fullMsgCooldown - dt)
      if (this.mode === 'playing') {
        this.clock += dt
        this.model.tick(this.clock, dt)
        const input = {
          throttle: this.input_.throttle(),
          steer: this.input_.steer(),
          boost: this.input_.consume('Space'),
        }
        if (input.throttle !== 0 || input.steer !== 0) this.movedOnce = true
        this.stepBoatPhysics(dt, input)
        this.handleCollection()
        this.updateDockPrompt()
      } else {
        // Docked: let the boat drift to a halt beside the station. The run clock keeps going (the fleets are working).
        this.model.advanceClock(dt)
        this.stepBoatPhysics(dt, { throttle: 0, steer: 0, boost: false })
      }
      this.runFleet(dt)
      this.runTrawlers(dt)
      if (this.pendingWinTimer > 0 && this.mode === 'playing') {
        this.pendingWinTimer -= dt
        if (this.pendingWinTimer <= 0) this.showCompletion()
      }
      this.updateHud(dt)
      this.hintTimer -= dt
      if (this.hintTimer <= 0) {
        this.hintTimer = 0.3
        this.updateHints()
        this.checkZone()
      }
      this.saveTimer -= dt
      if (this.saveTimer <= 0) {
        this.saveTimer = BALANCE.save.autosaveSeconds
        this.saveNow()
      }
    }
    this.updateCamera(dt, false)
  }

  private handleMenuKeys(): void {
    if (this.ui.scoresOpen) {
      // The high-score table is modal: Escape or Enter closes it and nothing else reacts.
      if (this.input_.consume('Escape') || this.input_.consume('Enter')) this.ui.hideScores()
      this.input_.flush()
      return
    }
    const esc = this.input_.consume('Escape')
    const e = this.input_.consume('KeyE')
    const enter = this.input_.consume('Enter')
    const r = this.input_.consume('KeyR')
    switch (this.mode) {
      case 'playing':
        if (esc) this.setPaused(true)
        else if (e && inDockRange(this.boat)) this.dock()
        else if (r) this.callTender()
        else if (this.input_.consume('Tab')) {
          this.ui.minimap.toggle()
          this.audio.play('click')
        }
        break
      case 'paused':
        if (esc) this.setPaused(false)
        break
      case 'docked':
        if (esc || e || enter) this.undock()
        else if (this.input_.consume('Digit1')) this.buyUpgrade('cargo')
        else if (this.input_.consume('Digit2')) this.buyUpgrade('engine')
        else if (this.input_.consume('Digit3')) this.buyUpgrade('width')
        else if (this.input_.consume('Digit4')) this.buyUpgrade('tender')
        else if (this.input_.consume('Digit5')) this.buyUpgrade('fleet')
        else if (this.input_.consume('Digit6')) this.buyUpgrade('sonar')
        else if (this.input_.consume('Digit7')) this.buyUpgrade('trawler')
        else if (this.input_.consume('Digit8')) this.buyUpgrade('trawlerFleet')
        break
      case 'win':
        // Enter inside the name field submits the form (the input module ignores keys typed into it).
        if (enter || esc) this.keepSailing()
        break
      default:
        break
    }
    // Number keys outside the dock are ignored.
    for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Tab']) this.input_.consume(k)
  }

  private stepBoatPhysics(dt: number, input: { throttle: number; steer: number; boost: boolean }): void {
    const stats = this.model.stats
    const ev = stepBoat(this.boat, input, stats, dt)
    const hit = { x: this.boat.x, y: this.boat.y }
    const impact = resolveCollisions(this.boat, this.obstacles, hit)
    if (ev.boostStarted) {
      this.audio.play('boost')
      this.splashAt(this.boat.x, this.boat.y, 10, false)
    }
    if (impact > 55) {
      this.audio.play('bump', impact)
      this.splash.explode(Math.min(10, Math.round(impact / 25)), hit.x, hit.y)
      if (impact > 150) this.cameras.main.shake(110, 0.0018)
    }

    const speed = boatSpeed(this.boat)
    const boosting = isBoosting(this.boat)
    this.boatView.update(this.boat.x, this.boat.y, this.boat.heading, this.time.now, speed / stats.maxSpeed, boosting, this.boat.turnVel)
    this.boatView.setFull(this.model.cargoFree === 0)

    // Wake
    const ratio = Math.min(1.6, speed / stats.maxSpeed)
    this.wakeAcc += ratio * (boosting ? 120 : 62) * dt
    const c = Math.cos(this.boat.heading)
    const s = Math.sin(this.boat.heading)
    while (this.wakeAcc >= 1) {
      this.wakeAcc -= 1
      const side = Math.random() < 0.5 ? -1 : 1
      const back = 30 + Math.random() * 8
      const lateral = side * (this.model.upgrades.engine >= 3 ? 8 : this.model.upgrades.engine > 0 ? 6.5 : 3.5) + (Math.random() - 0.5) * 4
      this.wake.emitParticleAt(this.boat.x - c * back - s * lateral, this.boat.y - s * back + c * lateral)
      if (ratio > 0.6 && Math.random() < 0.5) {
        // bow wave
        const bx = this.boat.x + c * 22 - s * side * 10
        const by = this.boat.y + s * 22 + c * side * 10
        this.wake.emitParticleAt(bx, by)
      }
    }
    this.audio.setEngine(this.mode === 'docked' ? 0 : ratio, boosting, this.model.upgrades.engine > 0)
  }

  private updateDockPrompt(): void {
    const near = inDockRange(this.boat)
    this.ui.setPrompt(near ? `Press <kbd>E</kbd> ${this.model.cargoUsed > 0 ? 'to unload &amp; upgrade' : 'for upgrades'}` : null)
    const pulse = 0.28 + Math.sin(this.time.now * 0.004) * 0.1
    this.dockRing.setAlpha(near ? pulse + 0.3 : this.model.cargoUsed > 0 ? pulse + 0.1 : pulse * 0.8)
    this.dockRing.setTint(this.model.cargoUsed > 0 ? 0xffe14a : 0xbff7ff)
  }

  private updateHud(dt: number): void {
    const now = this.clock
    this.ui.setCombo(this.model.combo.chain, this.model.combo.multiplier(), this.model.combo.remaining(now))
    this.ui.setBoost(boostReady(this.boat), boostCooldownFraction(this.boat), isBoosting(this.boat))
    this.updateNavigation(dt)
    const key = `${this.model.cargoUsed}/${this.model.capacity}`
    if (key !== this.lastCargoKey) {
      this.lastCargoKey = key
      this.refreshCargo(false)
    }
  }

  /** Station arrow, sonar / assistance arrows and the minimap. Everything here is derived from live game state. */
  private updateNavigation(dt: number): void {
    const cam = this.cameras.main
    const wv = cam.worldView
    const view: ViewRect = { x: wv.x, y: wv.y, width: wv.width, height: wv.height }
    const screen = { width: window.innerWidth, height: window.innerHeight }
    const insets = this.ui.edgeInsets()
    const markers: EdgeMarkerView[] = []

    // Sensor reading (sonar + late-game assistance) refreshed ten times a second.
    this.sensorTimer -= dt
    if (this.sensorTimer <= 0) {
      this.sensorTimer = 0.1
      this.sensorReading = this.model.readSensors(this.boat)
    }
    const profile = this.model.sensors

    if (this.mode === 'playing') {
      // The station: shown whenever it is off screen, wherever you are (no distance cut-off), hidden once it is
      // clearly in view or you are within docking range.
      const dist = distanceToDock(this.boat)
      const home = edgeIndicator(WORLD.dock, view, screen, { clearMargin: 80, hysteresis: 50, wasShown: this.homeShown, insets })
      this.homeShown = home.show
      const homePos = { x: home.x, y: home.y }
      if (home.show && !inDockRange(this.boat)) {
        markers.push({ key: 'home', kind: 'home', x: home.x, y: home.y, angle: home.angle, label: `Station ${metres(dist)} m` })
      }
      // Debris arrows.
      let slot = 0
      for (const m of this.sensorReading.arrows) {
        const ind = edgeIndicator({ x: m.x, y: m.y }, view, screen, {
          clearMargin: 70,
          hysteresis: 40,
          wasShown: this.arrowShown.get(m.key) ?? false,
          insets,
        })
        this.arrowShown.set(m.key, ind.show)
        if (!ind.show) continue
        // Do not stack on top of the station arrow.
        if (home.show && Math.hypot(ind.x - homePos.x, ind.y - homePos.y) < 64) continue
        markers.push({
          key: `d:${m.key}`,
          kind: profile.source === 'assist' ? 'assist' : 'sonar',
          x: ind.x,
          y: ind.y,
          angle: ind.angle,
          label: profile.subtle ? '' : distanceLabel(m.distance, profile.precision),
          subtle: profile.subtle,
        })
        slot += 1
      }
      void slot
      // Sonar pulse rings (purchased sonar only).
      if (profile.pulse) {
        this.sonarTimer += dt
        if (this.sonarTimer >= BALANCE.upgrades.sonar.pulseSeconds) {
          this.sonarTimer = 0
          this.sonarPing(false)
        }
      }
    } else {
      this.homeShown = false
    }
    this.ui.setEdgeMarkers(markers)

    this.ui.minimap.update(
      {
        boat: { x: this.boat.x, y: this.boat.y, heading: this.boat.heading },
        view,
        station: WORLD.dock,
        markers: this.sensorReading.minimap,
        tenders: this.model.fleet.tenders.map((t) => ({ x: t.x, y: t.y })),
        trawlers: this.model.trawlers.trawlers.map((t) => ({ x: t.x, y: t.y })),
      },
      performance.now() / 1000,
    )
  }

  private checkZone(): void {
    const z = zoneAt(this.boat.x, this.boat.y)
    if (z !== this.lastZone) {
      const first = this.lastZone === null
      this.lastZone = z
      this.ui.toast(WORLD.names[z], z === 'harbor' ? 'Easy pickings near the station' : z === 'shallows' ? 'Watch out for reefs and islands' : 'Big debris patches - far from home', 'zone')
      void first
    }
  }

  private updateDebrisViews(time: number, dt: number): void {
    for (const v of this.views) {
      v.cooldown = Math.max(0, v.cooldown - dt)
      const t = time * 0.001 + v.phase
      const bob = Math.sin(t * 1.9) * 1.6
      v.img.setPosition(v.spawn.x + Math.sin(t * 0.7) * 1.2, v.spawn.y + bob)
      v.img.setRotation(v.spawn.rot + Math.sin(t * 1.1) * 0.09)
      v.foam.setScale(v.foam.scaleX, v.foam.scaleY).setAlpha(0.45 + Math.sin(t * 2.3) * 0.12)
      v.shadow.setPosition(v.spawn.x + 2, v.spawn.y + 5 + bob * 0.4)
    }
  }

  private updateWater(time: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const wv = cam.worldView
    const pad = 260
    const x = wv.x - pad
    const y = wv.y - pad
    const w = wv.width + pad * 2
    const h = wv.height + pad * 2
    const t = time * 0.001
    this.waterBase.setPosition(x, y).setSize(w, h)
    this.waterBase.tilePositionX = x + t * 7
    this.waterBase.tilePositionY = y + Math.sin(t * 0.2) * 20
    this.caustic.setPosition(x, y).setSize(w, h)
    this.caustic.tilePositionX = (x - t * 12) / 1.5
    this.caustic.tilePositionY = (y + t * 8) / 1.5
    if (this.murk.visible) {
      this.murk.setPosition(x, y).setSize(w, h)
      this.murk.tilePositionX = (x + t * 5) / 2
      this.murk.tilePositionY = (y - t * 3) / 2
    }
  }

  private updateCamera(dt: number, frozen: boolean): void {
    const cam = this.cameras.main
    if (frozen) return
    const speed = this.mode === 'title' ? 0 : boatSpeed(this.boat)
    // Look ahead in the direction of travel.
    const targetLookX = this.boat.vx * (BALANCE.camera.lookAhead / this.model.stats.maxSpeed)
    const targetLookY = this.boat.vy * (BALANCE.camera.lookAhead / this.model.stats.maxSpeed)
    const lk = 1 - Math.exp(-BALANCE.camera.lookAheadResponse * dt)
    this.look.x += (targetLookX - this.look.x) * lk
    this.look.y += (targetLookY - this.look.y) * lk
    let tx = this.boat.x + this.look.x
    let ty = this.boat.y + this.look.y
    if (this.mode === 'title') {
      const t = this.time.now * 0.001
      tx = this.boat.x - cam.worldView.width * 0.2 + Math.sin(t * 0.25) * 60
      ty = this.boat.y + Math.cos(t * 0.2) * 40
    }
    if (this.mode === 'docked') tx -= cam.worldView.width * 0.1
    const k = this.mode === 'title' ? 1 - Math.exp(-2 * dt) : 1 - Math.exp(-BALANCE.camera.follow * 60 * dt)
    this.camPos.x += (tx - this.camPos.x) * k
    this.camPos.y += (ty - this.camPos.y) * k

    this.zoomPunch *= Math.exp(-7 * dt)
    const wantBoost = isBoosting(this.boat) ? BALANCE.camera.boostZoomOut : 1
    this.zoomBoost += (wantBoost - this.zoomBoost) * (1 - Math.exp(-4 * dt))
    const z = this.zoomBase * this.zoomBoost * (1 + this.zoomPunch) * (1 - Math.min(0.03, speed / 20000))
    cam.setZoom(z)
    cam.centerOn(this.camPos.x, this.camPos.y)
  }

  // Exposed for tests/debugging in the browser console.
  debugState(): unknown {
    return { mode: this.mode, boat: this.boat, progress: this.model.progress, credits: this.model.credits, patches: PATCHES.length, noUp: noUpgrades(), font: this.fontReady }
  }
}
