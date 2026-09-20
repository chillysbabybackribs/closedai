import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js'

export function ChatRenameDialog({
  open,
  chatId,
  currentTitle,
  onClose,
  onSave
}: {
  open: boolean
  chatId: string
  currentTitle: string
  onClose: () => void
  onSave: (chatId: string, title: string | null) => Promise<void>
}): JSX.Element {
  const [value, setValue] = useState(currentTitle)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(currentTitle)
      setSaving(false)
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 40)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open, currentTitle])

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await onSave(chatId, value.trim() || null)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(chatId, null)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="chat-rename-dialog" data-ui="chat.rename-dialog">
        <DialogTitle>Rename conversation</DialogTitle>
        <DialogDescription>
          Enter a custom title for this chat, or reset to use the default title.
        </DialogDescription>
        <form onSubmit={handleSubmit} className="chat-rename-form">
          <input
            ref={inputRef}
            type="text"
            className="chat-rename-input"
            data-ui="chat.rename-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
            placeholder="Conversation title"
            maxLength={100}
            spellCheck={false}
          />
          <div className="chat-rename-actions">
            <button
              type="button"
              className="chat-rename-btn chat-rename-reset"
              data-ui="chat.rename-reset"
              disabled={saving}
              onClick={handleReset}
            >
              Reset to default
            </button>
            <div className="chat-rename-actions-right">
              <button
                type="button"
                className="chat-rename-btn chat-rename-cancel"
                data-ui="chat.rename-cancel"
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="chat-rename-btn chat-rename-save"
                data-ui="chat.rename-save"
                disabled={saving}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
