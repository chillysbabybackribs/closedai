import { createHash } from 'node:crypto'
import { existsSync, unwatchFile, watchFile, type Stats } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A checkout launch (`npm run preview`) runs the built `out/` bundles. When anyone rebuilds —
 * the user or a model in any provider lane — the running app reloads its renderer surfaces once
 * the new renderer build has settled, so a UI change shows without a restart and without each
 * model having to know it must reload.
 *
 * Only the renderer reloads. When the main-process bundle differs from the one this process
 * launched with, the new renderer may call IPC the running main does not have, so the build is
 * left for the next launch instead.
 */
export type RendererBuildReloadDeps = {
  /** The built renderer entry every app surface loads (`out/renderer/index.html`). */
  rendererIndex: string
  /** The main-process bundle directory this process launched from (`out/main`). */
  mainDir: string
  /** Reloads every app surface showing the built renderer; returns how many were reloaded. */
  reload: () => number
  watch?: (path: string, onChange: () => void) => () => void
  exists?: (path: string) => boolean
  digest?: (dir: string) => Promise<string>
  /** Quiet period after the last change before the build counts as finished. */
  settleMs?: number
  log?: (message: string) => void
  /** The main bundle's digest taken at launch, shared with the build freshness probe. */
  launched?: Promise<string>
}

export const RENDERER_BUILD_SETTLE_MS = 1500
const POLL_INTERVAL_MS = 1000

/** Starts watching; returns the stop function. */
export function watchRendererBuilds(deps: RendererBuildReloadDeps): () => void {
  const exists = deps.exists ?? existsSync
  const digest = deps.digest ?? digestDirectory
  const log = deps.log ?? ((message: string) => console.info(`[renderer-build] ${message}`))
  const settleMs = deps.settleMs ?? RENDERER_BUILD_SETTLE_MS
  // Taken at launch, before any rebuild can replace the bundle this process is running.
  const launched = deps.launched ?? digest(deps.mainDir)
  launched.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let mainChangeReported = false

  const settle = (): void => {
    timer = null
    // A build empties the output directory first; only a written entry is a finished build.
    if (stopped || !exists(deps.rendererIndex)) return
    void Promise.all([launched, digest(deps.mainDir)]).then(([before, now]) => {
      if (stopped) return
      if (before !== now) {
        if (!mainChangeReported) log('main-process bundle changed since launch; restart the app to apply this build')
        mainChangeReported = true
        return
      }
      log(`reloaded ${deps.reload()} app surface(s) from the new renderer build`)
    }).catch((error: unknown) => log(`could not compare the rebuilt bundle: ${String(error)}`))
  }

  const unwatch = (deps.watch ?? pollFile)(deps.rendererIndex, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(settle, settleMs)
  })
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    unwatch()
  }
}

/** Stat polling by path survives the build deleting and recreating the file, which fs.watch does not. */
function pollFile(path: string, onChange: () => void): () => void {
  const listener = (current: Stats, previous: Stats): void => {
    if (current.mtimeMs !== previous.mtimeMs) onChange()
  }
  watchFile(path, { interval: POLL_INTERVAL_MS, persistent: false }, listener)
  return () => unwatchFile(path, listener)
}

/** Content digest of every file under `dir`, so a rebuild that emits identical output compares equal. */
export async function digestDirectory(dir: string): Promise<string> {
  const hash = createHash('sha1')
  const walk = async (current: string, prefix: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(path, `${prefix}${entry.name}/`)
      } else if (entry.isFile()) {
        hash.update(`${prefix}${entry.name}\0`)
        hash.update(await readFile(path))
      }
    }
  }
  await walk(dir, '')
  return hash.digest('hex')
}

export type BuildMode = 'packaged' | 'checkout' | 'dev'

/** Whether the running process still matches the code on disk; null means the question does not apply. */
export type BuildFreshness = {
  mode: BuildMode
  /** bundle-digest: out/ compared with launch. source-mtime: src/ edited after launch, a dev-server heuristic. */
  basis: 'bundle-digest' | 'source-mtime' | null
  mainStale: boolean | null
  preloadStale: boolean | null
  /** The built renderer is newer than the main window's last load (checkout launches only). */
  rendererStale: boolean | null
  rendererLoadedAt: string | null
}

export type BuildFreshnessDeps = {
  mode: BuildMode
  /** Built bundle directories this process launched from (`out/main`, `out/preload`). */
  mainDir: string
  preloadDir: string
  rendererIndex: string
  /** Under the dev server: source roots whose edits need a restart (main-side, preload). */
  mainSources: string[]
  preloadSources: string[]
  launchedAt: number
  digest?: (dir: string) => Promise<string>
  newestSourceMtime?: (dirs: string[]) => Promise<number>
  mtime?: (path: string) => Promise<number | null>
}

export type BuildFreshnessProbe = {
  /** The main bundle digest at launch; null when not compared by digest. */
  launchedMain: Promise<string> | null
  rendererLoaded(at?: number): void
  check(): Promise<BuildFreshness>
}

/**
 * The launch-vs-disk comparison the reload watcher already makes, exposed through
 * closedai_app.state so a model can tell a stale process from a broken change before it captures.
 */
export function createBuildFreshness(deps: BuildFreshnessDeps): BuildFreshnessProbe {
  const digest = deps.digest ?? digestDirectory
  const newest = deps.newestSourceMtime ?? newestSourceMtime
  const mtime = deps.mtime ?? fileMtime
  const byDigest = deps.mode === 'checkout'
  const launchedMain = byDigest ? digest(deps.mainDir) : null
  const launchedPreload = byDigest ? digest(deps.preloadDir) : null
  launchedMain?.catch(() => undefined)
  launchedPreload?.catch(() => undefined)
  let loadedAt: number | null = null

  const differs = async (launched: Promise<string>, dir: string): Promise<boolean | null> => {
    try { return (await launched) !== (await digest(dir)) } catch { return null }
  }
  const editedSinceLaunch = async (dirs: string[]): Promise<boolean | null> => {
    try { return (await newest(dirs)) > deps.launchedAt } catch { return null }
  }

  return {
    launchedMain,
    rendererLoaded: (at = Date.now()) => { loadedAt = at },
    check: async () => {
      const rendererLoadedAt = loadedAt === null ? null : new Date(loadedAt).toISOString()
      if (deps.mode === 'packaged') {
        return { mode: 'packaged', basis: null, mainStale: null, preloadStale: null, rendererStale: null, rendererLoadedAt }
      }
      if (deps.mode === 'dev') {
        const [mainStale, preloadStale] = await Promise.all([editedSinceLaunch(deps.mainSources), editedSinceLaunch(deps.preloadSources)])
        // The dev server hot-reloads the renderer itself.
        return { mode: 'dev', basis: 'source-mtime', mainStale, preloadStale, rendererStale: null, rendererLoadedAt }
      }
      const [mainStale, preloadStale, built] = await Promise.all([
        differs(launchedMain!, deps.mainDir), differs(launchedPreload!, deps.preloadDir), mtime(deps.rendererIndex)
      ])
      const rendererStale = built === null || loadedAt === null ? null : built > loadedAt
      return { mode: 'checkout', basis: 'bundle-digest', mainStale, preloadStale, rendererStale, rendererLoadedAt }
    }
  }
}

/** Newest modification time of any non-test file under `dirs`; tests do not change the running app. */
export async function newestSourceMtime(dirs: string[]): Promise<number> {
  let newest = 0
  for (const dir of dirs) {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    const times = await Promise.all(entries
      .filter((entry) => entry.isFile() && !/\.test\.[cm]?[jt]sx?$/.test(entry.name))
      .map(async (entry) => (await stat(join(entry.parentPath, entry.name))).mtimeMs))
    for (const time of times) if (time > newest) newest = time
  }
  return newest
}

async function fileMtime(path: string): Promise<number | null> {
  try { return (await stat(path)).mtimeMs } catch { return null }
}
