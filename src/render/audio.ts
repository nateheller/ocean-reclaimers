/** Fully synthesized audio (Web Audio): ambience, engine hum and sound effects. No audio files. */
import { BALANCE } from '../config/balance'

type SfxName = 'collect' | 'net' | 'splash' | 'bump' | 'full' | 'unload' | 'coin' | 'upgrade' | 'milestone' | 'click' | 'boost' | 'dock' | 'denied' | 'combo'

// A major pentatonic ladder so chained pickups sound like a rising melody.
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]
const BASE_HZ = 392 // G4

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfxBus!: GainNode
  private ambienceGain!: GainNode
  private engineGain!: GainNode
  private engineOsc!: OscillatorNode
  private engineOsc2!: OscillatorNode
  private engineFilter!: BiquadFilterNode
  private noiseBuffer!: AudioBuffer
  muted = false
  private ducked = false
  private lastCollect = 0

  /** Must be called from a user gesture (key press or click). */
  unlock(): void {
    if (!this.ctx) this.init()
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume()
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : BALANCE.audio.master
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    this.master.connect(comp).connect(ctx.destination)
    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = BALANCE.audio.sfx
    this.sfxBus.connect(this.master)

    // Brown-ish noise buffer, loopable.
    const len = ctx.sampleRate * 4
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    // Cross-fade the loop point so it does not click.
    const fade = 2000
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      data[len - fade + i] = data[len - fade + i] * (1 - t) + data[i] * t
    }
    this.noiseBuffer = buf

    this.startAmbience()
    this.startEngine()
  }

  private startAmbience(): void {
    const ctx = this.ctx!
    this.ambienceGain = ctx.createGain()
    this.ambienceGain.gain.value = BALANCE.audio.ambience
    this.ambienceGain.connect(this.master)

    const layer = (freq: number, q: number, gain: number, lfoHz: number, lfoDepth: number, type: BiquadFilterType) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noiseBuffer
      src.loop = true
      src.playbackRate.value = 0.9 + Math.random() * 0.2
      const filt = ctx.createBiquadFilter()
      filt.type = type
      filt.frequency.value = freq
      filt.Q.value = q
      const g = ctx.createGain()
      g.gain.value = gain
      const lfo = ctx.createOscillator()
      lfo.frequency.value = lfoHz
      const depth = ctx.createGain()
      depth.gain.value = gain * lfoDepth
      lfo.connect(depth).connect(g.gain)
      src.connect(filt).connect(g).connect(this.ambienceGain)
      src.start()
      lfo.start()
    }
    layer(420, 0.7, 0.55, 0.11, 0.7, 'lowpass') // slow swells
    layer(900, 0.9, 0.22, 0.17, 0.8, 'bandpass') // wash
    layer(3200, 0.6, 0.05, 0.23, 0.9, 'highpass') // sparkle of foam
  }

  private startEngine(): void {
    const ctx = this.ctx!
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 320
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 48
    this.engineOsc2 = ctx.createOscillator()
    this.engineOsc2.type = 'triangle'
    this.engineOsc2.frequency.value = 24
    this.engineOsc.connect(this.engineFilter)
    this.engineOsc2.connect(this.engineFilter)
    this.engineFilter.connect(this.engineGain).connect(this.master)
    this.engineOsc.start()
    this.engineOsc2.start()
  }

  /** Called every frame with speed ratio 0..1+ and whether boosting. */
  setEngine(speedRatio: number, boosting: boolean, upgraded: boolean): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const r = Math.min(1.6, Math.max(0, speedRatio))
    const base = (upgraded ? 54 : 46) + r * 46 + (boosting ? 22 : 0)
    this.engineOsc.frequency.setTargetAtTime(base, t, 0.08)
    this.engineOsc2.frequency.setTargetAtTime(base * 0.5, t, 0.08)
    this.engineFilter.frequency.setTargetAtTime(260 + r * 520 + (boosting ? 400 : 0), t, 0.1)
    const vol = this.ducked ? 0 : BALANCE.audio.engine * (0.35 + r * 1.1)
    this.engineGain.gain.setTargetAtTime(vol, t, 0.1)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (!this.ctx) return
    this.master.gain.setTargetAtTime(muted ? 0 : BALANCE.audio.master, this.ctx.currentTime, 0.05)
  }

  /** Quiet the world while paused. */
  setPaused(paused: boolean): void {
    this.ducked = paused
    if (!this.ctx) return
    this.ambienceGain.gain.setTargetAtTime(paused ? BALANCE.audio.ambience * 0.35 : BALANCE.audio.ambience, this.ctx.currentTime, 0.15)
    if (paused) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
  }

  // ---- one-shot helpers ----------------------------------------------------

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number, bus: AudioNode = this.sfxBus): void {
    const ctx = this.ctx
    if (!ctx) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(bus)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', delay = 0, sweepTo?: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const t0 = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    src.playbackRate.value = 1.6
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t0)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.sfxBus)
    src.start(t0, Math.random() * 2)
    src.stop(t0 + dur + 0.05)
  }

  play(name: SfxName, arg = 0): void {
    if (!this.ctx || this.muted) return
    switch (name) {
      case 'collect': {
        // arg = chain length. Rising pentatonic pluck + a splash.
        const step = LADDER[Math.min(Math.max(arg - 1, 0), LADDER.length - 1)]
        const f = BASE_HZ * Math.pow(2, step / 12)
        this.tone(f, 0.22, 'triangle', 0.32)
        this.tone(f * 2, 0.14, 'sine', 0.12, 0.01)
        this.noise(0.14, 1800, 0.8, 0.22, 'bandpass', 0, 700)
        this.lastCollect = performance.now()
        break
      }
      case 'net':
        this.tone(130, 0.28, 'sine', 0.45, 0, 60)
        this.noise(0.26, 900, 0.7, 0.35, 'lowpass', 0, 250)
        break
      case 'splash':
        this.noise(0.22, 2400, 0.6, 0.18, 'bandpass', 0, 600)
        break
      case 'bump':
        this.tone(90, 0.16, 'sine', Math.min(0.5, 0.15 + arg * 0.002), 0, 50)
        this.noise(0.12, 500, 0.8, 0.2, 'lowpass')
        break
      case 'full':
      case 'denied':
        this.tone(170, 0.16, 'square', 0.12, 0, 120)
        this.tone(140, 0.18, 'square', 0.12, 0.12, 95)
        break
      case 'unload':
        this.noise(0.5, 700, 0.5, 0.3, 'lowpass', 0, 200)
        this.tone(220, 0.3, 'triangle', 0.2, 0, 330)
        break
      case 'coin': {
        const f = 880 * Math.pow(2, (arg % 8) / 12)
        this.tone(f, 0.18, 'square', 0.07)
        this.tone(f * 1.5, 0.22, 'sine', 0.1, 0.05)
        break
      }
      case 'upgrade':
        ;[0, 4, 7, 12, 16].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.45, 'triangle', 0.22, i * 0.075))
        this.tone(660, 0.8, 'sine', 0.1, 0.35)
        break
      case 'milestone':
        ;[0, 4, 7, 11, 12, 16, 19, 24].forEach((s, i) => this.tone(262 * Math.pow(2, s / 12), 0.6, 'triangle', 0.2, i * 0.09))
        ;[0, 7, 12].forEach((s) => this.tone(131 * Math.pow(2, s / 12), 1.4, 'sine', 0.18, 0.1))
        break
      case 'click':
        this.tone(620, 0.07, 'triangle', 0.14)
        break
      case 'boost':
        this.noise(0.6, 600, 1.2, 0.35, 'bandpass', 0, 2600)
        this.tone(120, 0.5, 'sawtooth', 0.1, 0, 260)
        break
      case 'dock':
        this.tone(440, 0.14, 'sine', 0.2)
        this.tone(660, 0.2, 'sine', 0.2, 0.09)
        break
      case 'combo': {
        const f = 523 * Math.pow(2, arg / 12)
        this.tone(f, 0.3, 'square', 0.08)
        this.tone(f * 1.5, 0.3, 'triangle', 0.14, 0.06)
        this.tone(f * 2, 0.4, 'sine', 0.12, 0.12)
        break
      }
    }
  }

  /** Ms since the last pickup sound; used by the scene to vary feedback. */
  sinceCollect(): number {
    return performance.now() - this.lastCollect
  }
}
