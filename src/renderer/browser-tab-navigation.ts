export function tabIndexForKey(key: string, currentIndex: number, count: number): number | null {
  if (count <= 0) return null
  if (key === 'ArrowRight') return (currentIndex + 1) % count
  if (key === 'ArrowLeft') return (currentIndex - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
