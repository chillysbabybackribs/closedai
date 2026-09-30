import type { ProfileBootstrap, ProfileWriteResult } from '../../shared/local-profiles.js'
import {
  launchUserId,
  profileDataDir,
  readProfileRegistry,
  registryAccounts,
  registryActiveUserId,
  withOnboarding,
  writeProfileRegistry,
  type ProfileRegistry
} from './profile-registry.js'

/**
 * One process holds one profile's data for its whole life. Every store is opened from the data
 * directory chosen here, so another account's workspace is reached by relaunching into its
 * directory, never by swapping stores under a running app.
 */
export class ProfileSession {
  /** The directory this process uses as Electron's userData. */
  readonly dataDir: string

  private constructor(
    private readonly root: string,
    private registry: ProfileRegistry,
    private readonly launchedUserId: string | null,
    private readonly resumed: boolean
  ) {
    this.dataDir = profileDataDir(root, registry, launchedUserId)
  }

  /** Read the account list under `root` and settle which profile this launch opens. */
  static open(root: string): ProfileSession {
    const stored = readProfileRegistry(root)
    const launched = launchUserId(stored)
    const resumed = stored.resumeUserId !== null && stored.resumeUserId === launched
    if (stored.resumeUserId === null) return new ProfileSession(root, stored, launched, resumed)
    // A resume is good for the launch it was written for, and only that one.
    const registry = { ...stored, resumeUserId: null }
    writeProfileRegistry(root, registry)
    return new ProfileSession(root, registry, launched, resumed)
  }

  /** The account whose data is open. The root belongs to the home account once there is one. */
  currentUserId(): string | null {
    return this.dataDir === this.root ? this.registry.homeUserId : this.launchedUserId
  }

  bootstrap(): ProfileBootstrap {
    return { currentUserId: this.currentUserId(), onboarding: this.registry.onboarding, resumed: this.resumed }
  }

  write(onboarding: string): ProfileWriteResult {
    if (onboarding !== this.registry.onboarding) {
      this.registry = withOnboarding(this.registry, onboarding)
      writeProfileRegistry(this.root, this.registry)
    }
    return { currentUserId: this.currentUserId() }
  }

  /**
   * Prepare a relaunch into the signed-in account's data. False when no relaunch is needed or
   * allowed: the account is unknown, is not the one signed in, or already owns the open data.
   */
  prepareSwitch(userId: string): boolean {
    if (!registryAccounts(this.registry).some((account) => account.id === userId)) return false
    if (registryActiveUserId(this.registry) !== userId) return false
    if (profileDataDir(this.root, this.registry, userId) === this.dataDir) return false
    this.registry = { ...this.registry, resumeUserId: userId }
    writeProfileRegistry(this.root, this.registry)
    return true
  }
}
