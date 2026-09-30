import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { PROFILE_DIRECTORY, PROFILE_REGISTRY_FILE } from './profile-registry.js'

// Deleting an account takes two steps. Its data is first set aside under a name no account can
// have — one rename, safe before `ready` and while other stores are open — and then handed to
// the OS trash, so a deletion made by mistake can still be restored from there.

const REMOVED_PREFIX = '.deleted-'

/** What stays in the root when the home account's data leaves it. */
function staysInRoot(name: string): boolean {
  return name === PROFILE_DIRECTORY || name.startsWith(PROFILE_REGISTRY_FILE) || name.startsWith('Singleton')
}

/**
 * Move an account's data out of the way. `dataDir` is the root for the home account, whose
 * files are moved one by one because the root also holds the account list and every profile.
 */
export function setProfileDataAside(root: string, dataDir: string, label: string, now = Date.now()): void {
  const profiles = join(root, PROFILE_DIRECTORY)
  const aside = join(profiles, `${REMOVED_PREFIX}${now}-${label}`)
  mkdirSync(profiles, { recursive: true })
  if (dataDir !== root) {
    try {
      renameSync(dataDir, aside)
    } catch (error) {
      // An account that never opened its workspace has no directory yet.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return
  }
  mkdirSync(aside, { recursive: true })
  for (const name of readdirSync(root)) {
    if (staysInRoot(name)) continue
    try {
      renameSync(join(root, name), join(aside, name))
    } catch (error) {
      console.warn(`[profiles] could not set aside ${name}`, error)
    }
  }
}

/** Hand every set-aside directory to the trash; one the trash refuses is deleted outright. */
export async function purgeRemovedProfiles(root: string, trash: (path: string) => Promise<void>): Promise<void> {
  const profiles = join(root, PROFILE_DIRECTORY)
  const names = await readdir(profiles).catch(() => [] as string[])
  for (const name of names) {
    if (!name.startsWith(REMOVED_PREFIX)) continue
    const path = join(profiles, name)
    try {
      await trash(path)
    } catch {
      await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
        console.warn(`[profiles] could not delete ${path}`, error)
      })
    }
  }
}
