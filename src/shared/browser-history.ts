/** One omnibox suggestion row. `saved` marks a saved site, which ranks ahead of history. */
export type BrowserHistoryMatch = { url: string; title: string; completion: string; favicon?: string; saved?: boolean }
