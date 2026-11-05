/** Compact DOM HUD and menus layered over the game canvas. */
import type { UpgradeId } from '../config/balance'
import { LOCAL_SCORES_NOTE, PRIVACY_NOTE, RELEASE } from '../config/release'
import type { ScoreEntry } from '../core/leaderboard'
import { formatTime } from '../core/scoring'
import { checkPurchase, UPGRADE_IDS, UPGRADES, type UpgradeLevels } from '../core/upgrades'
import { Minimap } from './minimap'
import { feedbackMarkup } from './feedback'

export interface UIHandlers {
  onPlay(): void
  onContinue(): void
  onNewGame(): void
  onResume(): void
  onMute(): void
  onBuy(id: UpgradeId): void
  onUndock(): void
  onKeepSailing(): void
  /** The player confirmed a name for a qualifying score. */
  onSubmitScore(name: string): void
  /** Open the high-score table (the UI renders whatever the host returns). */
  onShowScores(): void
}

export interface DockData {
  credits: number
  levels: UpgradeLevels
  /** Station visits so far (some upgrades unlock after a few trips). */
  unloads: number
  unloaded: { credits: number; items: number; units: number } | null
}

/** One compact tender status chip in the HUD. */
export interface TenderChip {
  slot: number
  label: string
  color: string
  load: string
}

/** What the completion panel shows (all numbers are final; the UI only formats them). */
export interface CompletionView {
  goal: 75 | 100
  timeSeconds: number
  bandLabel: string
  baseScore: number
  multiplier: number
  finalScore: number
  credits: number
  bestChain: number
  /** Does the final score make the local top 10? */
  qualifies: boolean
  rank: number
  /** Score needed to enter a full table (only when it does not qualify). */
  threshold: number
  defaultName: string
  nameMaxLength: number
  /** Replaces the "not a top-10 score" line (e.g. when this run is already on the board). */
  note?: string
}

export interface SavedScoreView {
  rank: number
  name: string
  entryId: string
  newPersonalBest: boolean
  previousBest: number | null
  improvement: number
  entries: readonly ScoreEntry[]
}

export interface ScoresView {
  alternateLabel?: string
  onAlternate?: () => void
  title: string
  entries: readonly ScoreEntry[]
  highlightId: string | null
}

/** One screen-edge arrow (station, sonar, assistance). */
export interface EdgeMarkerView {
  key: string
  kind: 'home' | 'sonar' | 'assist'
  x: number
  y: number
  angle: number
  label: string
  subtle?: boolean
}

const ICONS = {
  cargo: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v9l-9 5-9-5z" fill="#ffb13b" stroke="#7a4300" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 8l9 5 9-5M12 13v9" fill="none" stroke="#7a4300" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffc933" stroke="#a86a00" stroke-width="1.8"/><circle cx="12" cy="12" r="6" fill="none" stroke="#e39a00" stroke-width="1.8"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M2 9c3-3 5 3 8 0s5 3 8 0 3 0 4-1M2 15c3-3 5 3 8 0s5 3 8 0 3 0 4-1" fill="none" stroke="#3ee6c1" stroke-width="2.4" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l3 7 7 .6-5.4 4.6 1.8 7.2L12 17.6 5.6 21.4l1.8-7.2L2 9.6 9 9z" fill="#ff7ab8" stroke="#8a2a5a" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  boost: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="#ffe14a" stroke="#8a6a00" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z" fill="#fff"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z" fill="#fff"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="#ff8a7a" stroke-width="2.2" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="#fff"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="#fff"/></svg>',
  upCargo: '<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="18" rx="3" fill="#2fb6c8" stroke="#0f6b82" stroke-width="2"/><rect x="8" y="13" width="7" height="7" fill="#ffd23f"/><rect x="17" y="13" width="7" height="7" fill="#ff9b2e"/><path d="M16 2v6M12 5l4-3 4 3" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  upEngine: '<svg viewBox="0 0 32 32"><rect x="5" y="7" width="12" height="18" rx="3" fill="#e83a2a" stroke="#7a1a10" stroke-width="2"/><rect x="19" y="7" width="8" height="18" rx="3" fill="#dfe6ea" stroke="#5c6e7c" stroke-width="2"/><path d="M5 28h22" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>',
  upWidth: '<svg viewBox="0 0 32 32"><path d="M4 26C6 14 10 8 16 6M28 26C26 14 22 8 16 6" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><circle cx="5" cy="25" r="3.4" fill="#ff5a2a"/><circle cx="27" cy="25" r="3.4" fill="#ff5a2a"/><path d="M9 21h14M11 16h10" stroke="#bff7ff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  upTender: '<svg viewBox="0 0 32 32"><path d="M3 20l3-8h17l6 8-3 5H7z" fill="#25b383" stroke="#0c5a42" stroke-width="2" stroke-linejoin="round"/><rect x="9" y="13" width="5" height="5" rx="1" fill="#ffd23f"/><rect x="15" y="13" width="5" height="5" rx="1" fill="#ff9b2e"/><path d="M3 20h26" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M5 28c3-2 5 2 8 0s5 2 8 0 5 2 8 0" fill="none" stroke="#bff7ff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  upSonar: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="3.2" fill="#7cf2ff"/><path d="M9.5 9.5a9 9 0 000 13M22.5 9.5a9 9 0 010 13M5.5 5.5a14.5 14.5 0 000 21M26.5 5.5a14.5 14.5 0 010 21" fill="none" stroke="#3ee6c1" stroke-width="2.4" stroke-linecap="round"/></svg>',
  upTrawler: '<svg viewBox="0 0 32 32"><path d="M3 21l3-9h11l5 5h6l-3 7H7z" fill="#8c63e0" stroke="#3a1f7a" stroke-width="2" stroke-linejoin="round"/><rect x="8" y="13" width="5" height="4" rx="1" fill="#ffd23f"/><path d="M22 17l6-8M27 9l-3 0M27 9l0 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M4 28c3-2 5 2 8 0s5 2 8 0 5 2 8 0" fill="none" stroke="#bff7ff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  upTrawlerFleet: '<svg viewBox="0 0 32 32"><path d="M2 16l2-6h10l4 6-2 4H4z" fill="#8c63e0" stroke="#3a1f7a" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 26l2-6h10l4 6-2 4H15z" fill="#b08cff" stroke="#3a1f7a" stroke-width="1.8" stroke-linejoin="round"/><path d="M26 3v6M23 6h6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
  upFleet: '<svg viewBox="0 0 32 32"><path d="M2 17l2-6h11l4 6-2 4H4z" fill="#25b383" stroke="#0c5a42" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 25l2-6h11l4 6-2 4H15z" fill="#45d6a0" stroke="#0c5a42" stroke-width="1.8" stroke-linejoin="round"/><path d="M26 4v6M23 7h6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
}

const UPGRADE_ICON: Record<UpgradeId, string> = {
  boostReserve: ICONS.boost,
  boostRecovery: ICONS.upEngine,
  cargo: ICONS.upCargo,
  engine: ICONS.upEngine,
  width: ICONS.upWidth,
  tender: ICONS.upTender,
  fleet: ICONS.upFleet,
  sonar: ICONS.upSonar,
  trawler: ICONS.upTrawler,
  trawlerFleet: ICONS.upTrawlerFleet,
}

/** Group headings shown above the first row of each shop group. */
const DOCK_GROUP: Partial<Record<UpgradeId, string>> = {
  boostReserve: 'Boost systems',
  tender: 'Cargo tenders',
  sonar: 'Exploration',
  trawler: 'Auto trawlers',
}

function el<T extends HTMLElement>(root: ParentNode, sel: string): T {
  const found = root.querySelector<T>(sel)
  if (!found) throw new Error(`Missing UI element ${sel}`)
  return found
}

export class GameUI {
  private cargoVal: HTMLElement
  private cargoBar: HTMLElement
  private cargoPill: HTMLElement
  private creditsVal: HTMLElement
  private creditsPill: HTMLElement
  private scoreVal: HTMLElement
  private cleanVal: HTMLElement
  private cleanBar: HTMLElement
  private comboBox: HTMLElement
  private comboMult: HTMLElement
  private comboChain: HTMLElement
  private comboBar: HTMLElement
  private boostBox: HTMLElement
  private boostFill: HTMLElement
  private prompt: HTMLElement
  private hint: HTMLElement
  private toastBox: HTMLElement
  private muteBtn: HTMLElement
  private pauseMute: HTMLElement
  private edges: HTMLElement
  private readonly edgeEls = new Map<string, { el: HTMLElement; arrow: HTMLElement; label: HTMLElement; text: string; kind: string; timer: number }>()
  private scores: HTMLElement
  private scoresBack: (() => void) | null = null
  /** The corner chart (created with the HUD). */
  readonly minimap: Minimap
  private tenderChips = 0
  private trawlerChips = 0
  private lastTrawlerChips = ''
  private title: HTMLElement
  private pause: HTMLElement
  private dock: HTMLElement
  private win: HTMLElement
  private popLayer: HTMLElement
  private chips: HTMLElement
  private chipsT: HTMLElement
  private chipsW: HTMLElement
  private noticeBox: HTMLElement
  private lastChips = ''
  private noticeTimer = 0

  private shownCredits = 0
  private creditAnim = 0
  private lastCombo = -1
  private lastPrompt = ''
  private lastHint = ''
  private toastTimer = 0
  private newArmed: HTMLElement | null = null
  private newArmTimer = 0

  private h: UIHandlers

  constructor(private root: HTMLElement, handlers: UIHandlers) {
    this.h = handlers
    root.innerHTML = `
      <div class="hud hud-tl">
        <div class="pill" id="p-cargo"><i class="ico">${ICONS.cargo}</i><div class="stack"><span class="lbl">Cargo</span><b class="val" id="v-cargo">0/20</b><div class="bar"><div id="b-cargo"></div></div></div></div>
        <div class="pill" id="p-credits"><i class="ico">${ICONS.coin}</i><div class="stack"><span class="lbl">Credits</span><b class="val" id="v-credits">0</b></div></div>
        <div class="pill wide" id="p-clean"><i class="ico">${ICONS.wave}</i><div class="stack"><span class="lbl">Coral Bay cleaned</span><b class="val" id="v-clean">0%</b>
          <div class="bar clean"><div id="b-clean"></div><span class="tick" style="left:25%"></span><span class="tick" style="left:50%"></span><span class="tick" style="left:75%"></span><span class="tick goal" style="left:100%"></span></div></div></div>
      </div>
      <div class="hud hud-tr">
        <div class="pill small"><i class="ico">${ICONS.star}</i><div class="stack"><span class="lbl">Score</span><b class="val" id="v-score">0</b></div></div>
        <button class="round" id="btn-mute" title="Sound (M)" tabindex="-1">${ICONS.sound}</button>
        <button class="round" id="btn-pause" title="Pause (Esc)" tabindex="-1">${ICONS.pause}</button>
      </div>
      <div class="combo" id="combo"><div class="combo-mult" id="c-mult">x1.2</div><div class="combo-chain" id="c-chain">3 in a row</div><div class="combo-bar"><div id="c-bar"></div></div></div>
      <div class="boost" id="boost"><i class="ico">${ICONS.boost}</i><div class="stack"><span class="lbl"><kbd>Space</kbd> Boost</span><div class="bar boostbar"><div id="b-boost"></div></div></div></div>
      <div class="tchips" id="tchips"><div id="tc-t"></div><div id="tc-w"></div></div>
      <div class="notice" id="notice"></div>
      <div class="toast" id="toast"></div>
      <div class="hint" id="hint"></div>
      <div class="prompt" id="prompt"></div>
      <div class="edges" id="edges"></div>
      <div class="pop-layer" id="pops"></div>
      <div id="mm-slot"></div>

      <section class="dock" id="dock" hidden></section>

      <section class="screen title" id="title">
        <div class="title-card">
          <div class="logo"><span class="logo-top">Ocean</span><span class="logo-main">Reclaimers</span></div>
          <p class="tagline">Scoop up the plastic. Clear Coral Bay.</p>
          <p class="release-label">${RELEASE.label}</p>
          <div class="btns" id="title-btns"></div>
          ${feedbackMarkup()}
          <div class="keys">
            <div><span class="kg"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span> or <span class="kg"><kbd>&uarr;</kbd><kbd>&larr;</kbd><kbd>&darr;</kbd><kbd>&rarr;</kbd></span> sail</div>
            <div><kbd>Space</kbd> boost &nbsp; <kbd>E</kbd> station &nbsp; <kbd>R</kbd> tender &nbsp; <kbd>Tab</kbd> map &nbsp; <kbd>Esc</kbd> pause</div>
          </div>
          <p class="fine">A fictional, simplified game inspired by ISS Breakthrough SB012. Not a scientific model.</p>
          <p class="fine privacy-note">${PRIVACY_NOTE}</p>
        </div>
      </section>

      <section class="screen overlay" id="pause" hidden>
        <div class="card">
          <h2>Paused</h2>
          <div class="btns col">
            <button class="btn primary" data-act="resume" tabindex="-1">Resume</button>
            <button class="btn" data-act="mute" id="pause-mute" tabindex="-1">Sound: On</button>
            <button class="btn" data-act="scores" tabindex="-1">High Scores</button>
            <button class="btn danger" data-act="new" tabindex="-1">New Game</button>
          </div>
          ${feedbackMarkup()}
          <div class="keys small">
            <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows &ndash; sail</div>
            <div><kbd>Space</kbd> boost &nbsp; <kbd>E</kbd> station &nbsp; <kbd>R</kbd> tender &nbsp; <kbd>Tab</kbd> map &nbsp; <kbd>M</kbd> mute</div>
          </div>
          <p class="fine">Fictional and simplified. Visual changes are stylized rewards, not scientific predictions.</p>
          <p class="fine privacy-note">${PRIVACY_NOTE}</p>
        </div>
      </section>

      <section class="screen overlay" id="win" hidden></section>
      <section class="screen overlay scores-screen" id="scores" hidden></section>
    `
    this.cargoVal = el(root, '#v-cargo')
    this.cargoBar = el(root, '#b-cargo')
    this.cargoPill = el(root, '#p-cargo')
    this.creditsVal = el(root, '#v-credits')
    this.creditsPill = el(root, '#p-credits')
    this.scoreVal = el(root, '#v-score')
    this.cleanVal = el(root, '#v-clean')
    this.cleanBar = el(root, '#b-clean')
    this.comboBox = el(root, '#combo')
    this.comboMult = el(root, '#c-mult')
    this.comboChain = el(root, '#c-chain')
    this.comboBar = el(root, '#c-bar')
    this.boostBox = el(root, '#boost')
    this.boostFill = el(root, '#b-boost')
    this.prompt = el(root, '#prompt')
    this.hint = el(root, '#hint')
    this.toastBox = el(root, '#toast')
    this.muteBtn = el(root, '#btn-mute')
    this.pauseMute = el(root, '#pause-mute')
    this.edges = el(root, '#edges')
    this.scores = el(root, '#scores')
    this.minimap = new Minimap(el(root, '#mm-slot'))
    this.title = el(root, '#title')
    this.pause = el(root, '#pause')
    this.dock = el(root, '#dock')
    this.chips = el(root, '#tchips')
    this.chipsT = el(root, '#tc-t')
    this.chipsW = el(root, '#tc-w')
    this.noticeBox = el(root, '#notice')
    this.win = el(root, '#win')
    this.popLayer = el(root, '#pops')

    // Never let a clicked button keep keyboard focus (Space would re-trigger it).
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault()
    })
    this.muteBtn.addEventListener('click', () => this.h.onMute())
    el(root, '#btn-pause').addEventListener('click', () => this.requestPause())
    this.pause.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'resume') this.h.onResume()
      else if (act === 'mute') this.h.onMute()
      else if (act === 'scores') this.h.onShowScores()
      else if (act === 'new') this.confirmNew(e.target as HTMLElement, () => this.h.onNewGame())
    })
    this.scores.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]') || e.target === this.scores) this.hideScores()
    })
    this.onPauseRequest = () => {}
    // Native Enter activation on the feedback link must not also start/resume the game.
    root.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('.feedback-link') && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation()
    })
  }

  setHandlers(h: UIHandlers): void {
    this.h = h
  }

  /** Set by the scene so the HUD pause button can ask for a pause. */
  onPauseRequest: () => void
  private requestPause(): void {
    this.onPauseRequest()
  }

  private confirmNew(target: HTMLElement, go: () => void): void {
    const btn = target.closest<HTMLElement>('button')
    if (!btn) return
    if (this.newArmed === btn) {
      window.clearTimeout(this.newArmTimer)
      btn.textContent = btn.dataset.label ?? 'New Game'
      this.newArmed = null
      go()
      return
    }
    this.disarmNew()
    btn.dataset.label = btn.textContent ?? 'New Game'
    btn.textContent = 'Click again to erase progress'
    this.newArmed = btn
    this.newArmTimer = window.setTimeout(() => this.disarmNew(), 3000)
  }

  private disarmNew(): void {
    if (this.newArmed) {
      this.newArmed.textContent = this.newArmed.dataset.label ?? 'New Game'
      this.newArmed = null
    }
  }

  // ---- title -----------------------------------------------------------------

  showTitle(hasSave: boolean, progress: number): void {
    const box = el(this.root, '#title-btns')
    box.innerHTML = hasSave
      ? `<button class="btn primary big" data-act="continue" tabindex="-1">Continue <small>${Math.round(progress * 100)}% cleaned</small></button><button class="btn" data-act="scores" tabindex="-1">High Scores</button><button class="btn" data-act="new" tabindex="-1">New Game</button>`
      : `<button class="btn primary big" data-act="play" tabindex="-1">Set Sail</button><button class="btn" data-act="scores" tabindex="-1">High Scores</button>`
    box.onclick = (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
      if (!btn) return
      if (btn.dataset.act === 'play') this.h.onPlay()
      else if (btn.dataset.act === 'continue') this.h.onContinue()
      else if (btn.dataset.act === 'scores') this.h.onShowScores()
      else if (btn.dataset.act === 'new') this.confirmNew(btn, () => this.h.onNewGame())
    }
    this.title.hidden = false
    this.root.classList.add('on-title')
  }

  hideTitle(): void {
    this.title.hidden = true
    this.root.classList.remove('on-title')
  }

  get titleOpen(): boolean {
    return !this.title.hidden
  }

  // ---- HUD values -------------------------------------------------------------

  setCargo(used: number, cap: number): void {
    this.cargoVal.textContent = `${used}/${cap}`
    const f = cap > 0 ? used / cap : 0
    this.cargoBar.style.width = `${f * 100}%`
    this.cargoPill.classList.toggle('warn', f >= 0.8 && f < 1)
    this.cargoPill.classList.toggle('full', f >= 1)
  }

  bumpCargo(): void {
    this.cargoPill.classList.remove('bump')
    void this.cargoPill.offsetWidth
    this.cargoPill.classList.add('bump')
  }

  flashFull(): void {
    this.cargoPill.classList.remove('shake')
    void this.cargoPill.offsetWidth
    this.cargoPill.classList.add('shake')
  }

  setCredits(n: number, animate = true): void {
    window.cancelAnimationFrame(this.creditAnim)
    if (!animate || n === this.shownCredits) {
      this.shownCredits = n
      this.creditsVal.textContent = String(n)
      return
    }
    const from = this.shownCredits
    const start = performance.now()
    const dur = Math.min(900, 250 + Math.abs(n - from) * 12)
    this.creditsPill.classList.remove('bump')
    void this.creditsPill.offsetWidth
    this.creditsPill.classList.add('bump')
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      this.shownCredits = Math.round(from + (n - from) * eased)
      this.creditsVal.textContent = String(this.shownCredits)
      if (t < 1) this.creditAnim = window.requestAnimationFrame(tick)
    }
    this.creditAnim = window.requestAnimationFrame(tick)
  }

  setScore(n: number): void {
    this.scoreVal.textContent = n.toLocaleString('en-US')
  }

  setProgress(frac: number): void {
    const pct = Math.floor(frac * 100 + 1e-6)
    this.cleanVal.textContent = `${pct}%`
    this.cleanBar.style.width = `${Math.min(100, (frac / 1) * 100)}%`
    this.root.dataset.clean = String(Math.floor(pct / 25))
  }

  setCombo(chain: number, mult: number, remaining: number): void {
    if (chain < 2 || remaining <= 0) {
      if (this.lastCombo !== 0) {
        this.comboBox.classList.remove('on')
        this.lastCombo = 0
      }
      return
    }
    this.comboBox.classList.add('on')
    this.comboBox.classList.toggle('boosted', mult > 1)
    this.comboBox.dataset.tier = mult >= 2 ? '3' : mult >= 1.5 ? '2' : mult > 1 ? '1' : '0'
    this.comboMult.textContent = mult > 1 ? `\u00d7${mult.toFixed(1)}` : `${chain} chain`
    this.comboChain.textContent = mult > 1 ? `${chain} in a row` : 'keep going!'
    this.comboBar.style.width = `${remaining * 100}%`
    if (this.lastCombo !== chain) {
      this.lastCombo = chain
      this.comboBox.classList.remove('hit')
      void this.comboBox.offsetWidth
      this.comboBox.classList.add('hit')
    }
  }

  setBoost(ready: boolean, cooldownFrac: number, active: boolean): void {
    this.boostBox.classList.toggle('ready', ready)
    this.boostBox.classList.toggle('active', active)
    this.boostFill.style.width = `${(ready ? 1 : 1 - cooldownFrac) * 100}%`
  }

  setPrompt(html: string | null): void {
    const v = html ?? ''
    if (v === this.lastPrompt) return
    this.lastPrompt = v
    this.prompt.innerHTML = v
    this.prompt.classList.toggle('on', v !== '')
  }

  setHint(text: string | null): void {
    const v = text ?? ''
    if (v === this.lastHint) return
    this.lastHint = v
    this.hint.innerHTML = v
    this.hint.classList.toggle('on', v !== '')
  }

  toast(title: string, sub = '', kind: 'zone' | 'milestone' = 'zone'): void {
    window.clearTimeout(this.toastTimer)
    this.toastBox.className = `toast ${kind}`
    this.toastBox.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`
    void this.toastBox.offsetWidth
    this.toastBox.classList.add('on')
    this.toastTimer = window.setTimeout(() => this.toastBox.classList.remove('on'), kind === 'milestone' ? 4200 : 2200)
  }

  /** Compact status chips for the cargo tenders (hidden when you have none). */
  setTenders(chips: readonly TenderChip[]): void {
    const key = chips.map((c) => `${c.slot}|${c.label}|${c.color}|${c.load}`).join(';')
    if (key === this.lastChips) return
    this.lastChips = key
    this.tenderChips = chips.length
    this.chipsT.innerHTML = chips
      .map(
        (c) =>
          `<div class="tchip"><i class="ico">${ICONS.upTender}</i><span class="tn">T${c.slot + 1}</span><span class="ts" style="color:${c.color}">${c.label}</span><span class="tl">${c.load}</span></div>`,
      )
      .join('')
    this.chips.classList.toggle('on', this.tenderChips + this.trawlerChips > 0)
  }

  /** Compact status chips for the autonomous trawlers (hidden when you have none). */
  setTrawlers(chips: readonly TenderChip[]): void {
    const key = chips.map((c) => `${c.slot}|${c.label}|${c.color}|${c.load}`).join(';')
    if (key === this.lastTrawlerChips) return
    this.lastTrawlerChips = key
    this.trawlerChips = chips.length
    this.chipsW.innerHTML = chips
      .map(
        (c) =>
          `<div class="tchip trawl"><i class="ico">${ICONS.upTrawler}</i><span class="tn">A${c.slot + 1}</span><span class="ts" style="color:${c.color}">${c.label}</span><span class="tl">${c.load}</span></div>`,
      )
      .join('')
    this.chips.classList.toggle('on', this.tenderChips + this.trawlerChips > 0)
  }

  /** Where edge arrows may sit: clear of the corner pills and the fleet chips. */
  edgeInsets(): { top: number; right: number; bottom: number; left: number } {
    const chips = this.tenderChips + this.trawlerChips
    // The chips sit in a column under the top-left pills, so they widen the left margin instead of pushing every arrow down.
    return { top: 100, right: 56, bottom: 150, left: chips > 0 ? 176 : 56 }
  }

  /** A small, short-lived message that never blocks the view (e.g. "Tender delivered +18"). */
  notice(text: string, kind: 'good' | 'warn' | '' = ''): void {
    window.clearTimeout(this.noticeTimer)
    this.noticeBox.className = `notice ${kind}`
    this.noticeBox.textContent = text
    void this.noticeBox.offsetWidth
    this.noticeBox.classList.add('on')
    this.noticeTimer = window.setTimeout(() => this.noticeBox.classList.remove('on'), 2200)
  }

  setMuted(muted: boolean): void {
    this.muteBtn.innerHTML = muted ? ICONS.muted : ICONS.sound
    this.muteBtn.classList.toggle('off', muted)
    this.pauseMute.textContent = `Sound: ${muted ? 'Off' : 'On'}`
  }

  /** Draw the current set of screen-edge arrows (station, sonar, assistance). Missing keys fade out. */
  setEdgeMarkers(markers: readonly EdgeMarkerView[]): void {
    const seen = new Set<string>()
    for (const m of markers) {
      seen.add(m.key)
      let rec = this.edgeEls.get(m.key)
      if (!rec) {
        const el = document.createElement('div')
        el.innerHTML = '<div class="earrow"></div><span class="elabel"></span>'
        this.edges.appendChild(el)
        rec = {
          el,
          arrow: el.firstElementChild as HTMLElement,
          label: el.lastElementChild as HTMLElement,
          text: '',
          kind: '',
          timer: 0,
        }
        this.edgeEls.set(m.key, rec)
        // Appear on the next frame so the fade-in transition runs.
        window.requestAnimationFrame(() => rec?.el.classList.add('on'))
      }
      window.clearTimeout(rec.timer)
      if (rec.kind !== m.kind || rec.el.dataset.subtle !== String(!!m.subtle)) {
        rec.kind = m.kind
        rec.el.dataset.subtle = String(!!m.subtle)
        rec.el.className = `edge ${m.kind}${m.subtle ? ' subtle' : ''} on`
      }
      rec.el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px) translate(-50%, -50%)`
      rec.arrow.style.transform = `rotate(${m.angle.toFixed(3)}rad)`
      if (rec.text !== m.label) {
        rec.text = m.label
        rec.label.textContent = m.label
        rec.label.hidden = m.label === ''
      }
    }
    for (const [key, rec] of this.edgeEls) {
      if (seen.has(key) || rec.el.classList.contains('gone')) continue
      rec.el.classList.remove('on')
      rec.el.classList.add('gone')
      rec.timer = window.setTimeout(() => {
        rec.el.remove()
        this.edgeEls.delete(key)
      }, 350)
    }
  }

  /** Screen-space floating text (used for big combo callouts). */
  pop(text: string, cls = ''): void {
    const d = document.createElement('div')
    d.className = `pop ${cls}`
    d.textContent = text
    this.popLayer.appendChild(d)
    window.setTimeout(() => d.remove(), 1400)
  }

  // ---- pause ------------------------------------------------------------------

  showPause(show: boolean): void {
    this.pause.hidden = !show
    if (!show) this.disarmNew()
  }

  get pauseOpen(): boolean {
    return !this.pause.hidden
  }

  // ---- docked menu --------------------------------------------------------------

  showDock(data: DockData): void {
    this.dock.hidden = false
    this.root.classList.add('dock-open')
    this.renderDock(data)
  }

  renderDock(data: DockData): void {
    const u = data.unloaded
    const summary = u
      ? u.items > 0
        ? `<div class="sum good">Unloaded <b>${u.items}</b> item${u.items === 1 ? '' : 's'} <span>(${u.units} units)</span><em>+${u.credits}</em></div>`
        : '<div class="sum">Hold is empty &ndash; go find more plastic!</div>'
      : ''
    const ctx = { levels: data.levels, unloads: data.unloads }
    const rows = UPGRADE_IDS.map((id, i) => {
      const def = UPGRADES[id]
      const level = data.levels[id]
      const check = checkPurchase(id, ctx, data.credits)
      const state = check.ok ? 'afford' : check.reason === 'max' ? 'max' : check.reason
      const pips = Array.from({ length: def.maxLevel }, (_, n) => `<s class="${n < level ? 'on' : ''}"></s>`).join('')
      const now = def.effect(level)
      const next = check.ok || check.reason !== 'max' ? def.effect(level + 1) : ''
      const fx = next ? `<span class="fx"><em>${now}</em><i>&rarr;</i><strong>${next}</strong></span>` : `<span class="fx"><strong>${now}</strong></span>`
      const note = !check.ok && check.reason !== 'max' ? `<small>${check.message}</small>` : ''
      const action = check.ok
        ? `<button class="buy" data-buy="${id}" tabindex="-1">${check.cost}<i class="ico sm">${ICONS.coin}</i></button>`
        : check.reason === 'max'
          ? '<span class="tag">MAX</span>'
          : `<span class="price">${check.cost}<i class="ico sm">${ICONS.coin}</i></span>`
      const lv = def.maxLevel > 1 ? `<span class="lv">Lv ${level}/${def.maxLevel}</span>` : level >= 1 ? '<span class="lv">Built</span>' : ''
      const group = DOCK_GROUP[id]
      const sep = group ? ' sep' : ''
      return `<div class="up ${state}${sep}" data-up="${id}"${group ? ` data-sep="${group}"` : ''}><kbd>${(i + 1) % 10}</kbd><i class="uico">${UPGRADE_ICON[id]}</i><div class="utext"><div class="uhead"><b>${def.name}</b>${lv}</div><div class="pips">${pips}</div>${fx}${note}</div>${action}</div>`
    }).join('')
    this.dock.innerHTML = `
      <header><b>Reclamation Station</b><span class="bal"><i class="ico sm">${ICONS.coin}</i>${data.credits}</span></header>
      ${summary}
      <div class="ups">${rows}</div>
      <footer><button class="btn primary" data-undock tabindex="-1"><kbd>E</kbd> Set sail</button></footer>`
    this.dock.onclick = (e) => {
      const t = e.target as HTMLElement
      const buy = t.closest<HTMLElement>('[data-buy]')
      if (buy) this.h.onBuy(buy.dataset.buy as UpgradeId)
      else if (t.closest('[data-undock]')) this.h.onUndock()
    }
  }

  shakeUpgrade(id: UpgradeId): void {
    const row = this.dock.querySelector<HTMLElement>(`[data-up="${id}"]`)
    if (!row) return
    row.classList.remove('shake')
    void row.offsetWidth
    row.classList.add('shake')
  }

  flashUpgrade(id: UpgradeId): void {
    const row = this.dock.querySelector<HTMLElement>(`[data-up="${id}"]`)
    row?.classList.add('flash')
  }

  hideDock(): void {
    this.dock.hidden = true
    this.root.classList.remove('dock-open')
  }

  get dockOpen(): boolean {
    return !this.dock.hidden
  }

  // ---- completion panel + high scores ---------------------------------------------------------------------------

  showWin(d: CompletionView): void {
    const n = (v: number) => v.toLocaleString('en-US')
    const entry = d.qualifies
      ? `<div class="entry" id="score-slot">
           <div class="rank-note">This would be <b>#${d.rank}</b> on the local leaderboard</div>
           <form class="name-form" id="name-form" autocomplete="off">
             <label for="name-in">Your name</label>
             <input id="name-in" type="text" maxlength="${d.nameMaxLength}" value="${d.defaultName}" spellcheck="false" autocomplete="off" />
             <button class="btn primary" type="submit" tabindex="-1">Save Score</button>
           </form>
         </div>`
      : `<div class="entry" id="score-slot"><div class="rank-note dim">${d.note ?? `Not a top-10 score this time &ndash; ${n(d.threshold)}+ gets on the board. Try a faster run!`}</div></div>`
    this.win.innerHTML = `
      <div class="card win-card">
        <div class="ribbon">Expedition complete</div>
        <h2>CORAL BAY COMPLETE!</h2>
        <p>${d.goal}% of the starting debris is gone. The water is clear and the sea is full of life.</p>
        <div class="calc">
          <div class="row"><span>Cleanup time</span><b>${formatTime(d.timeSeconds)}</b></div>
          <div class="row"><span>Arcade score</span><b>${n(d.baseScore)}</b></div>
          <div class="row bonus"><span>Time multiplier <em>${d.bandLabel}</em></span><b>${d.multiplier > 1 ? `\u00d7${d.multiplier.toFixed(2).replace(/0$/, '')}` : 'none'}</b></div>
          <div class="row final"><span>Final score</span><b>${n(d.finalScore)}</b></div>
        </div>
        <div class="mini-stats"><span>Best chain <b>${d.bestChain}</b></span><span>Credits <b>${n(d.credits)}</b></span></div>
        ${entry}
        <div class="btns">
          <button class="btn primary" data-act="keep" tabindex="-1">Keep Sailing</button>
          <button class="btn" data-act="scores" tabindex="-1">High Scores</button>
          <button class="btn" data-act="new" tabindex="-1">New Game</button>
        </div>
        <p class="local-scores-note">${LOCAL_SCORES_NOTE}</p>
        <p class="fine">A fictional, simplified game. The clearer water and extra wildlife are stylized rewards, not scientific predictions.</p>
      </div>`
    this.win.hidden = false
    this.win.onclick = (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
      if (!btn) return
      if (btn.dataset.act === 'keep') this.h.onKeepSailing()
      else if (btn.dataset.act === 'scores') this.h.onShowScores()
      else if (btn.dataset.act === 'new') this.confirmNew(btn, () => this.h.onNewGame())
    }
    const form = this.win.querySelector<HTMLFormElement>('#name-form')
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault()
        const input = form.querySelector<HTMLInputElement>('#name-in')
        const button = form.querySelector<HTMLButtonElement>('button')
        if (button?.disabled) return
        if (button) button.disabled = true // a double click can never submit twice
        this.h.onSubmitScore(input?.value ?? '')
      }
      window.setTimeout(() => {
        const input = form.querySelector<HTMLInputElement>('#name-in')
        input?.focus()
        input?.select()
      }, 60)
    }
  }

  /** The name currently typed in the completion form, or null when the form is not showing. */
  currentName(): string | null {
    const input = this.win.querySelector<HTMLInputElement>('#name-in')
    const button = this.win.querySelector<HTMLButtonElement>('#name-form button')
    if (!input || button?.disabled) return null
    return input.value
  }

  /** Replace the name form with the result of a successful submission. */
  showScoreSaved(r: SavedScoreView): void {
    const slot = this.win.querySelector('#score-slot')
    if (!slot) return
    const n = (v: number) => v.toLocaleString('en-US')
    const pb = r.newPersonalBest
      ? `<div class="pb big"><b>NEW PERSONAL BEST!</b><span>Previous: ${n(r.previousBest ?? 0)}</span><span>New: ${n((r.previousBest ?? 0) + r.improvement)}</span><span>Improvement: <b>+${n(r.improvement)}</b></span></div>`
      : r.previousBest !== null
        ? `<div class="pb dim">${r.name}'s best is still ${n(r.previousBest)}</div>`
        : `<div class="pb">First score for ${r.name}!</div>`
    slot.innerHTML = `<div class="rank-note good">Saved &ndash; <b>#${r.rank}</b> on the Coral Bay leaderboard</div>${pb}`
  }

  /** The score could not be recorded (storage unavailable, or this run was already recorded). */
  showScoreError(text: string): void {
    const slot = this.win.querySelector('#score-slot')
    if (slot) slot.innerHTML = `<div class="rank-note dim">${text}</div>`
  }

  hideWin(): void {
    this.win.hidden = true
  }

  get winOpen(): boolean {
    return !this.win.hidden
  }

  showScores(v: ScoresView): void {
    const n = (x: number) => x.toLocaleString('en-US')
    const rows = v.entries
      .map((e, i) => {
        const d = e.date ? new Date(e.date) : null
        const date = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
        const bonus = e.multiplier > 1 ? `\u00d7${e.multiplier.toFixed(2).replace(/0$/, '')}` : '-'
        const me = v.highlightId === e.id ? ' me' : ''
        const esc = e.name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
        return `<tr class="${me.trim()}"><td class="r">${i + 1}</td><td class="nm">${esc}</td><td class="sc">${n(e.finalScore)}</td><td>${formatTime(e.timeSeconds)}</td><td>${bonus}</td><td class="dt">${date}</td></tr>`
      })
      .join('')
    this.scores.innerHTML = `
      <div class="card scores-card">
        <h2>High Scores</h2>
        <div class="sub">${v.title}</div>
        ${
          v.entries.length > 0
            ? `<table class="board"><thead><tr><th>#</th><th>Name</th><th>Score</th><th>Time</th><th>Bonus</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty">No scores yet &ndash; complete a run in this category to set the first one.</div>'
        }
        <div class="btns"><button class="btn" data-alternate tabindex="-1">${v.alternateLabel ?? 'Other Scores'}</button><button class="btn primary" data-close tabindex="-1">Close</button></div>
        <p class="local-scores-note">${LOCAL_SCORES_NOTE}</p>
        <p class="fine">Final score = arcade score &times; time multiplier.</p>
      </div>`
    this.scores.querySelector<HTMLButtonElement>('[data-alternate]')?.addEventListener('click', () => v.onAlternate?.())
    this.scores.hidden = false
  }

  hideScores(): void {
    this.scores.hidden = true
    this.scoresBack?.()
  }

  get scoresOpen(): boolean {
    return !this.scores.hidden
  }

  /** Show or hide the in-game HUD (hidden behind the title screen). */
  setHudVisible(visible: boolean): void {
    this.root.classList.toggle('hud-hidden', !visible)
  }
}
