import type { ClosedaiApi } from '../shared/api.js'

declare global {
  interface Window {
    closedai: ClosedaiApi
  }
}

export {}
