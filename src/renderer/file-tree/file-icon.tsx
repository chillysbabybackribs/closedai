import fileNames from './symbols/names.json' with { type: 'json' }
import fileExtensions from './symbols/extensions.json' with { type: 'json' }
import folderNames from './symbols/folders.json' with { type: 'json' }
const icons = import.meta.glob('./symbols/icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const names = fileNames as Record<string, string>
const extensions = fileExtensions as Record<string, string>
const folders = folderNames as Record<string, string>
export function fileIconKey(name: string, directory: boolean): string {
  const lower = name.toLowerCase()
  if (directory) return folders[lower] ?? 'folder'
  if (names[lower]) return names[lower]
  const parts = lower.split('.')
  for (let i = 1; i < parts.length; i++) {
    const key = extensions[parts.slice(i).join('.')]
    if (key) return key
  }
  return 'document'
}
export function FileIcon({ name, directory }: { name: string; directory: boolean }) {
  const src = icons[`./symbols/icons/${fileIconKey(name, directory)}.svg`]
  return <img src={src} width={17} height={17} alt="" aria-hidden="true" draggable={false} />
}
