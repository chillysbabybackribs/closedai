export function readTreeState<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}
export function saveTreeState(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Full or unavailable storage. */ }
}
export function expansionKey(root: string): string { return `closedai.files.expanded:${root}` }
export function readExpansion(root: string): string[] {
  const value = readTreeState<unknown>(expansionKey(root), [])
  return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string').slice(0, 200) : []
}
