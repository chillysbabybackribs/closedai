import type { ChangeEvent, JSX, RefObject } from 'react'
import { FileImage, FileText, Plus, Upload, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
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
    const source: Extract<ChatAttachment, { kind: 'image' }>['source'] = path
      ? { type: 'path', path }
      : { type: 'url', url: await readDataUrl(file) }
    return { id: crypto.randomUUID(), kind: 'image', name: file.name || 'Pasted image', source }
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
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="prompt-composer-tool rounded-full"
            aria-label="Add attachment"
            disabled={disabled}
          >
            <Plus size={18} aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="prompt-attachment-menu" side="top" align="start" sideOffset={8}>
            <DropdownMenu.Item className="prompt-attachment-menu-item" onSelect={() => inputRef.current?.click()}>
              <Upload size={16} aria-hidden="true" />
              Upload files
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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
        <AttachmentCard key={attachment.id} attachment={attachment} />
      ))}
    </AttachmentGroup>
  )
}

function AttachmentCard({
  attachment,
  onRemove
}: {
  attachment: ChatAttachmentSummary
  onRemove?: () => void
}): JSX.Element {
  const preview = imagePreview(attachment)
  return (
    <Attachment size="sm">
      <AttachmentMedia variant={preview ? 'image' : 'icon'}>
        {preview
          ? <img src={preview} alt="" />
          : attachment.kind === 'image' ? <FileImage aria-hidden="true" /> : <FileText aria-hidden="true" />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription>{attachment.kind === 'image' ? 'Image' : 'File'}</AttachmentDescription>
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

function imagePreview(attachment: ChatAttachmentSummary): string | null {
  if (!isImageAttachment(attachment)) return null
  return attachment.source.type === 'url' ? attachment.source.url : null
}

function isImageAttachment(attachment: ChatAttachmentSummary): attachment is Extract<ChatAttachment, { kind: 'image' }> {
  return attachment.kind === 'image' && 'source' in attachment
}
