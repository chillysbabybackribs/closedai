import type { ClosedaiApi } from '../shared/api.js'

declare global {
  interface Window {
    closedai: ClosedaiApi
  }
}

declare module '*.jpg' {
  const url: string
  export default url
}

export {}
