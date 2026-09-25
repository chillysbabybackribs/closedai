// The page clock a video render drives. Installed before any page script runs, it replaces the
// page's sense of time — timers, requestAnimationFrame, Date, performance.now, CSS and Web
// Animations, and <video> playback — with a virtual clock that only moves when the recorder
// steps it. Every frame is therefore exactly `index / fps` seconds into the page's timeline no
// matter how long the capture itself takes. Fetches, image decode, and font loading still run
// in real time, which is why the recorder waits for load and fonts before frame zero.

/** Page-side API the recorder calls through executeJavaScript. */
export type VideoClockApi = {
  /** Flush pending zero-delay work and settle fonts; call once after load. */
  prepare(): Promise<void>
  /** Advance virtual time to `ms`, run everything due, and resolve after the frame paints. */
  step(ms: number): Promise<void>
}

export const VIDEO_CLOCK_GLOBAL = '__closedaiVideoClock'

/** Serialised into the page; must stay self-contained (no imports, no closure over module scope). */
function installVideoClock(globalName: string): void {
  const w = window as unknown as Record<string, unknown> & Window
  if (w[globalName]) return
  const realRaf = window.requestAnimationFrame.bind(window)
  const realTimeout = window.setTimeout.bind(window)
  const RealDate = Date
  const epoch = RealDate.now()
  const MAX_TIMER_RUNS = 20_000
  let now = 0
  let nextId = 1
  type Timer = { id: number; at: number; fn: (...args: unknown[]) => void; args: unknown[]; every: number }
  const timers = new Map<number, Timer>()
  let frameCallbacks = new Map<number, FrameRequestCallback>()
  const animationBirth = new WeakMap<Animation, number>()
  const videoBirth = new WeakMap<HTMLMediaElement, number>()

  const schedule = (fn: unknown, delay: unknown, args: unknown[], repeat: boolean): number => {
    const id = nextId++
    if (typeof fn !== 'function') return id
    const ms = Math.max(0, Number(delay) || 0)
    timers.set(id, { id, at: now + ms, fn: fn as Timer['fn'], args, every: repeat ? Math.max(1, ms) : 0 })
    return id
  }
  const cancel = (id: unknown): void => { timers.delete(Number(id)) }
  Object.assign(window, {
    setTimeout: (fn: unknown, delay?: unknown, ...args: unknown[]) => schedule(fn, delay, args, false),
    setInterval: (fn: unknown, delay?: unknown, ...args: unknown[]) => schedule(fn, delay, args, true),
    clearTimeout: cancel,
    clearInterval: cancel,
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = nextId++; frameCallbacks.set(id, callback); return id },
    cancelAnimationFrame: (id: number) => { frameCallbacks.delete(id) }
  })
  performance.now = () => now
  // A plain function rather than a subclass: bundlers must not inject helpers into this source.
  const VirtualDate = function (this: unknown, ...args: unknown[]): unknown {
    if (!new.target) return new RealDate(epoch + now).toString()
    return args.length === 0 ? new RealDate(epoch + now) : new (RealDate as unknown as new (...a: unknown[]) => Date)(...args)
  } as unknown as DateConstructor
  Object.assign(VirtualDate, { now: () => epoch + now, parse: RealDate.parse, UTC: RealDate.UTC, prototype: RealDate.prototype })
  ;(window as unknown as { Date: DateConstructor }).Date = VirtualDate

  // Element.animate starts an animation mid-step; record its birth at the exact virtual time.
  const realAnimate = Element.prototype.animate
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
    const animation = realAnimate.apply(this, args)
    animationBirth.set(animation, now)
    animation.pause()
    return animation
  }

  const runDueTimers = (until: number): void => {
    for (let runs = 0; runs < MAX_TIMER_RUNS; runs++) {
      let due: Timer | null = null
      for (const timer of timers.values()) {
        if (timer.at <= until && (!due || timer.at < due.at || (timer.at === due.at && timer.id < due.id))) due = timer
      }
      if (!due) break
      now = Math.max(now, due.at)
      if (due.every) due.at += due.every
      else timers.delete(due.id)
      try { due.fn(...due.args) } catch (error) { console.error(error) }
    }
    now = until
  }

  const runFrameCallbacks = (): void => {
    const callbacks = frameCallbacks
    frameCallbacks = new Map()
    for (const callback of callbacks.values()) {
      try { callback(now) } catch (error) { console.error(error) }
    }
  }

  // CSS animations, transitions, and Web Animations: pause each on first sight and hold it at
  // the virtual time since it began. An animation the page paused itself is left alone.
  const seekAnimations = (): void => {
    for (const animation of document.getAnimations()) {
      let birth = animationBirth.get(animation)
      if (birth === undefined) {
        if (animation.playState !== 'running') continue
        birth = now
        animationBirth.set(animation, birth)
        animation.pause()
      }
      animation.currentTime = (now - birth) * animation.playbackRate
    }
  }

  const seekVideos = async (): Promise<void> => {
    const seeks: Promise<void>[] = []
    for (const video of Array.from(document.querySelectorAll('video'))) {
      let birth = videoBirth.get(video)
      if (birth === undefined) {
        if (!video.autoplay && video.paused) continue
        birth = now
        videoBirth.set(video, birth)
      }
      if (!video.paused) video.pause()
      let seconds = ((now - birth) / 1000) * video.playbackRate
      const length = video.duration
      if (Number.isFinite(length) && length > 0) seconds = video.loop ? seconds % length : Math.min(seconds, length)
      if (Math.abs(video.currentTime - seconds) < 0.0005 && !video.seeking) continue
      seeks.push(new Promise((resolve) => {
        const done = (): void => { video.removeEventListener('seeked', done); resolve() }
        video.addEventListener('seeked', done)
        video.currentTime = seconds
        realTimeout(done, 1_500)
      }))
    }
    await Promise.all(seeks)
  }

  const painted = (): Promise<void> => new Promise((resolve) => realRaf(() => realRaf(() => resolve())))

  const api = {
    async prepare(): Promise<void> {
      runDueTimers(0)
      await document.fonts?.ready
      runDueTimers(0)
      seekAnimations()
      await seekVideos()
      await painted()
    },
    async step(ms: number): Promise<void> {
      runDueTimers(Math.max(now, ms))
      runFrameCallbacks()
      seekAnimations()
      await seekVideos()
      await painted()
    }
  }
  Object.defineProperty(window, globalName, { value: api, enumerable: false })
}

/** Script source for Page.addScriptToEvaluateOnNewDocument. */
export function videoClockSource(): string {
  return `(${installVideoClock.toString()})(${JSON.stringify(VIDEO_CLOCK_GLOBAL)});`
}
