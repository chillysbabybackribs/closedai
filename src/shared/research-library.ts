/** Public literature shared across this app's projects; never trusted instructions. */
export type LibrarySettings = {
  topics: string[]
  lookbackDays: number
  enabled: boolean
}

export type LibraryPaper = {
  id: string
  title: string
  abstract: string
  abstractTruncated: boolean
  publishedAt: string
  url: string
  topics: string[]
  retrievedAt: string
  sha256: string
}

export type LibraryRefresh = {
  startedAt: string
  finishedAt: string
  state: 'completed' | 'partial' | 'failed' | 'cancelled'
  received: number
  added: number
  errors: Array<{ topic: string; message: string }>
}

export type LibrarySnapshot = {
  settings: LibrarySettings
  refreshing: boolean
  lastRefresh: LibraryRefresh | null
  papers: LibraryPaper[]
  total: number
  dismissed: number
}

export type ResearchLibraryApi = {
  snapshot(): Promise<LibrarySnapshot>
  configure(settings: LibrarySettings): Promise<LibrarySnapshot>
  refresh(): Promise<LibrarySnapshot>
  cancel(): Promise<void>
  dismiss(id: string): Promise<LibrarySnapshot>
}
