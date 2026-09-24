import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { ChatTranscriptItem } from '../shared/chat.js'
import { recordOfOrEmpty as recordOf, stringOf } from './json-coerce.js'

/** Transcript label for native image-generation tool rows (Codex, Cursor, Antigravity, Claude). */
export const GENERATE_IMAGE_LABEL = 'Generate image'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const DATA_IMAGE_URL = /data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+/i

export function isNativeGenerateImageTool(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized === 'generate_image'
    || normalized === 'generateimage'
    || normalized === 'image_generation'
    || normalized === 'imagegeneration'
}

export function isGenerateImageToolLabel(label: string): boolean {
  return label === GENERATE_IMAGE_LABEL || isNativeGenerateImageTool(label)
}

export function promoteGeneratedImage(input: {
  itemId: string
  turnId: string | null
  failed: boolean
  imageUrl: string | null | undefined
  savedPath?: string
  caption?: string
}): Extract<ChatTranscriptItem, { type: 'screenshot' }> | null {
  if (input.failed || !input.imageUrl) return null
  return {
    type: 'screenshot',
    id: input.itemId,
    turnId: input.turnId,
    imageUrl: input.imageUrl,
    surface: 'generated_image',
    caption: input.caption?.split('\n')[0]?.trim() ?? '',
    ...(input.savedPath ? { savedPath: input.savedPath } : {})
  }
}

export function isLikelyGenerateImageTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase()
  if (!normalized.includes('image')) return false
  return normalized.includes('generate') || normalized.includes('generating') || normalized.includes('generation')
}

/** Collect path-like strings from tool arguments for generate_image promotion. */
export function imagePathHintsFromValue(value: unknown): string[] {
  const hints: string[] = []
  const visit = (entry: unknown): void => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      if (trimmed) hints.push(trimmed)
      return
    }
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item)
      return
    }
    const record = recordOf(entry)
    if (!record) return
    for (const nested of Object.values(record)) visit(nested)
  }
  visit(value)
  return hints
}

/** Pull inline image bytes or a saved path from tool output text and optional structured content. */
export function resolveGeneratedImageEvidence(
  text: string,
  content?: unknown,
  hints: readonly string[] = []
): { imageUrl: string; savedPath?: string } | null {
  const fromBlocks = imageUrlFromContentBlocks(content)
  if (fromBlocks) return fromBlocks
  const candidates = [text, ...hints]
  for (const candidate of candidates) {
    const dataUrl = extractDataImageUrl(candidate)
    if (dataUrl) return { imageUrl: dataUrl }
    const path = extractImageFilePath(candidate)
    const loaded = loadImageFile(path)
    if (loaded) return loaded
    const fromArtifact = resolveMarkdownArtifactImage(candidate)
    if (fromArtifact) return fromArtifact
  }
  return null
}

/** Antigravity often references a brain artifact `.md` that embeds the generated `.jpg`. */
function resolveMarkdownArtifactImage(text: string): { imageUrl: string; savedPath?: string } | null {
  const mdPath = extractMarkdownFilePath(text)
  if (!mdPath || !existsSync(mdPath)) return null
  try {
    const markdown = readFileSync(mdPath, 'utf8')
    const imagePath = extractImageFilePath(markdown)
    const loaded = loadImageFile(imagePath)
    return loaded ? { ...loaded, savedPath: loaded.savedPath ?? imagePath ?? undefined } : null
  } catch {
    return null
  }
}

export function resolveGeneratedImageToolOutcome(input: {
  text: string
  content?: unknown
  rawOutput?: unknown
  hints?: readonly string[]
}): { imageUrl: string; savedPath?: string } | null {
  const raw = recordOf(input.rawOutput)
  const rawHints = [
    stringOf(raw.path),
    stringOf(raw.filePath),
    stringOf(raw.file_path),
    stringOf(raw.imagePath),
    stringOf(raw.image_path),
    stringOf(raw.savedPath),
    stringOf(raw.saved_path),
    stringOf(raw.url),
    stringOf(raw.href)
  ].filter(Boolean)
  return resolveGeneratedImageEvidence(input.text, input.content, [...(input.hints ?? []), ...rawHints])
}

function loadImageFile(path: string | null): { imageUrl: string; savedPath: string } | null {
  const normalized = normalizeAbsolutePath(path)
  if (!normalized || !existsSync(normalized)) return null
  try {
    const mime = mimeFromExt(normalized)
    const base64 = readFileSync(normalized).toString('base64')
    return { imageUrl: `data:${mime};base64,${base64}`, savedPath: normalized }
  } catch {
    return null
  }
}

export function imageUrlFromContentBlocks(content: unknown): { imageUrl: string; savedPath?: string } | null {
  if (!Array.isArray(content)) return null
  for (const entry of content) {
    const block = recordOf(entry)
    if (!block) continue
    const nested = recordOf(block.content)
    const fromBlock = dataUrlFromBlock(block) ?? (nested ? dataUrlFromBlock(nested) : null)
    if (fromBlock) return { imageUrl: fromBlock }
    const source = recordOf(block.source)
    if (block.type === 'image' && source.type === 'base64' && typeof source.data === 'string') {
      const mime = stringOf(source.media_type) || stringOf(source.mediaType) || 'image/png'
      return { imageUrl: `data:${mime};base64,${source.data}` }
    }
  }
  return null
}

function dataUrlFromBlock(block: Record<string, unknown>): string | null {
  if (block.type !== 'image') return null
  const mime = stringOf(block.mimeType) || stringOf(block.mime_type) || 'image/png'
  const data = stringOf(block.data)
  return data ? `data:${mime};base64,${data}` : null
}

function extractDataImageUrl(text: string): string | null {
  const match = DATA_IMAGE_URL.exec(text)
  return match ? match[0]!.replace(/\s+/g, '') : null
}

function extractImageFilePath(text: string): string | null {
  const markdown = markdownImageTarget(text)
  if (markdown) return markdown
  const fileUrl = decodeFileUrl(text)
  if (fileUrl && isImagePath(fileUrl)) return fileUrl
  const trimmed = text.trim()
  if (trimmed && isImagePath(trimmed)) return trimmed
  for (const line of text.split('\n')) {
    const candidate = line.trim()
    const fromLine = markdownImageTarget(candidate) ?? decodeFileUrl(candidate)
    if (fromLine && isImagePath(fromLine)) return fromLine
    if (isImagePath(candidate)) return candidate
  }
  const embedded = /((?:\/(?!\/)[^\s"')]+|[A-Za-z]:\\[^\s"')]+)\.(?:png|jpe?g|gif|webp))/i.exec(text)
  if (embedded?.[1] && isImagePath(embedded[1])) return normalizeAbsolutePath(embedded[1])
  const quoted = /(?:path|file|saved|output)[:\s]+["']?([^\s"']+\.(?:png|jpe?g|gif|webp))["']?/i.exec(text)
  return quoted?.[1] ?? null
}

function extractMarkdownFilePath(text: string): string | null {
  const match = /((?:\/|[A-Za-z]:\\)[^\s"')]+\.md)/i.exec(text)
  return match?.[1] ?? null
}

function markdownImageTarget(text: string): string | null {
  const match = /!\[[^\]]*]\(([^)]+)\)/.exec(text)
  if (!match) return null
  const target = match[1]!.trim().replace(/^["']|["']$/g, '')
  if (target.startsWith('file://')) {
    const path = decodeFileUrl(target)
    return path && isImagePath(path) ? path : null
  }
  return isImagePath(target) ? target : null
}

function decodeFileUrl(text: string): string | null {
  const match = /file:\/\/\/([^\s"'<>]+)|file:\/\/([^\s"'<>]+)/i.exec(text)
  const raw = match?.[1] ?? match?.[2]
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function isImagePath(value: string): boolean {
  const path = normalizeAbsolutePath(value)
  if (!path || path.startsWith('{') || /^https?:\/\//i.test(path)) return false
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) && (path.startsWith('/') || /^[A-Za-z]:\\/.test(path))
}

function normalizeAbsolutePath(path: string | null): string | null {
  if (!path) return null
  const trimmed = path.trim()
  if (/^[A-Za-z]:\\/.test(trimmed)) return trimmed
  if (!trimmed.startsWith('/')) return trimmed
  return trimmed.replace(/\/{2,}/g, '/')
}

function mimeFromExt(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'image/png'
  }
}
