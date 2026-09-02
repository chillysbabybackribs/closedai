import type { ChangeEvent, JSX, RefObject } from 'react'
import { FileImage, FileText, FileUp, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle
} from '../components/ui/attachment.js'
import { Button } from '../components/ui/button.js'
import { PromptInputAction } from '../components/ui/prompt-input.js'
import type { ChatAttachment, ChatAttachmentSummary } from '../shared/chat.js'

const IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i

export async function attachmentsFromFiles(files: FileList | File[]): Promise<{
  attachments: ChatAttachment[]
  errors: string[]
}> {
  const settled = await Promise.allSettled(Array.from(files, attachmentFromFile))
  return settled.reduce<{ attachments: ChatAttachment[]; errors: string[] }>((result, entry) => {
    if (entry.status === 'fulfilled') result.attachments.push(entry.value)
    else result.errors.push(entry.reason instanceof Error ? entry.reason.message : String(entry.reason))
    return result
  }, { attachments: [], errors: [] })
}

async function attachmentFromFile(file: File): Promise<ChatAttachment> {
  const path = window.closedai.chat.attachmentPath(file)
  const image = file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)
  if (image) {
    const dataUrl = await readDataUrl(file).catch(() => undefined)
    const source: Extract<ChatAttachment, { kind: 'image' }>['source'] = path
      ? { type: 'path', path }
      : { type: 'url', url: dataUrl || '' }
    return {
      id: crypto.randomUUID(),
      kind: 'image',
      name: file.name || 'Pasted image',
      source,
      ...(dataUrl ? { url: dataUrl } : {})
    }
  }
  if (!path) throw new Error(`${file.name || 'This file'} is not backed by a local file`)
  return { id: crypto.randomUUID(), kind: 'file', name: file.name, path }
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image'))
    reader.onerror = () => reject(new Error(`Could not read ${file.name || 'pasted image'}`))
    reader.readAsDataURL(file)
  })
}

export function AttachmentPicker({
  disabled,
  inputRef,
  onChange
}: {
  disabled: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}): JSX.Element {
  return (
    <>
      <input ref={inputRef} className="prompt-attachment-input" type="file" multiple onChange={onChange} />
      <PromptInputAction tooltip="Upload files">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="prompt-composer-tool rounded-full"
          aria-label="Upload files"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp size={20} strokeWidth={2.1} aria-hidden="true" />
        </Button>
      </PromptInputAction>
    </>
  )
}

export function AttachmentChips({
  attachments,
  onRemove
}: {
  attachments: ChatAttachment[]
  onRemove: (id: string) => void
}): JSX.Element | null {
  if (!attachments.length) return null
  return (
    <AttachmentGroup className="prompt-attachments" aria-label="Attachments">
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          onRemove={() => onRemove(attachment.id)}
        />
      ))}
    </AttachmentGroup>
  )
}

export function TranscriptAttachments({
  attachments
}: {
  attachments: ChatAttachmentSummary[]
}): JSX.Element | null {
  if (!attachments.length) return null
  return (
    <AttachmentGroup className="prompt-message-user-attachments" aria-label="Attachments">
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          className={attachment.kind === 'image' ? 'prompt-image-attachment' : undefined}
        />
      ))}
    </AttachmentGroup>
  )
}

function AttachmentCard({
  attachment,
  onRemove,
  className
}: {
  attachment: ChatAttachmentSummary | ChatAttachment
  onRemove?: () => void
  className?: string
}): JSX.Element {
  const preview = imagePreview(attachment)
  if (attachment.kind === 'image' || preview) {
    return (
      <div className={cn('prompt-image-attachment-card', className)} data-slot="attachment" data-kind="image">
        <div className="prompt-image-attachment-media">
          {preview ? (
            <img src={preview} alt={attachment.name} />
          ) : (
            <div className="prompt-image-placeholder">
              <FileImage aria-hidden="true" />
            </div>
          )}
          {onRemove ? (
            <button
              type="button"
              className="prompt-image-remove-btn"
              aria-label={`Remove ${attachment.name}`}
              onClick={onRemove}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <span className="prompt-image-attachment-name" title={attachment.name}>
          {attachment.name}
        </span>
      </div>
    )
  }

  return (
    <Attachment size="sm" className={className}>
      <AttachmentMedia variant="icon">
        <FileText aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription>File</AttachmentDescription>
      </AttachmentContent>
      {onRemove ? (
        <AttachmentActions>
          <AttachmentAction type="button" aria-label={`Remove ${attachment.name}`} onClick={onRemove}>
            <X aria-hidden="true" />
          </AttachmentAction>
        </AttachmentActions>
      ) : null}
    </Attachment>
  )
}

function toImageSrc(pathOrUrl: string): string {
  if (!pathOrUrl) return ''
  if (
    pathOrUrl.startsWith('data:') ||
    pathOrUrl.startsWith('file:') ||
    pathOrUrl.startsWith('http:') ||
    pathOrUrl.startsWith('https:')
  ) {
    return pathOrUrl
  }
  return `file://${encodeURI(pathOrUrl)}`
}

function imagePreview(attachment: ChatAttachmentSummary | ChatAttachment): string | null {
  if (attachment.kind !== 'image') return null
  if ('url' in attachment && typeof attachment.url === 'string' && attachment.url) {
    return attachment.url
  }
  if ('source' in attachment && attachment.source) {
    const source = attachment.source
    if (source.type === 'url' && source.url) return source.url
    if (source.type === 'path' && source.path) return toImageSrc(source.path)
  }
  if ('path' in attachment && typeof attachment.path === 'string' && attachment.path) {
    return toImageSrc(attachment.path)
  }
  return null
}
