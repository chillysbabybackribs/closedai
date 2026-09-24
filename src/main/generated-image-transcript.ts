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

/** Pull inline image bytes or a saved path from tool output text and optional structured content. */
export function resolveGeneratedImageEvidence(text: string, content?: unknown): { imageUrl: string; savedPath?: string } | null {
  const fromBlocks = imageUrlFromContentBlocks(content)
  if (fromBlocks) return fromBlocks
  const dataUrl = extractDataImageUrl(text)
  if (dataUrl) return { imageUrl: dataUrl }
  const path = extractImageFilePath(text)
  if (!path || !existsSync(path)) return null
  try {
    const mime = mimeFromExt(path)
    const base64 = readFileSync(path).toString('base64')
    return { imageUrl: `data:${mime};base64,${base64}`, savedPath: path }
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
  const trimmed = text.trim()
  if (trimmed && isImagePath(trimmed)) return trimmed
  for (const line of text.split('\n')) {
    const candidate = line.trim()
    if (isImagePath(candidate)) return candidate
  }
  const embedded = /((?:\/|[A-Za-z]:\\)[^\s"']+\.(?:png|jpe?g|gif|webp))/i.exec(text)
  if (embedded?.[1] && isImagePath(embedded[1])) return embedded[1]
  const quoted = /(?:path|file|saved|output)[:\s]+["']?([^\s"']+\.(?:png|jpe?g|gif|webp))["']?/i.exec(text)
  return quoted?.[1] ?? null
}

function isImagePath(value: string): boolean {
  if (!value || value.startsWith('{') || /^https?:\/\//i.test(value)) return false
  return IMAGE_EXTENSIONS.has(extname(value).toLowerCase()) && (value.startsWith('/') || /^[A-Za-z]:\\/.test(value))
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
