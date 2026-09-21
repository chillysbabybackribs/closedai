import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js'
import { errorMessage } from './error-message.js'

export function ChatRenameForm({
  chatId,
  currentTitle,
  onClose,
  onSave
}: {
  chatId: string
  currentTitle: string
  onClose: () => void
  onSave: (chatId: string, title: string | null) => Promise<void>
}): JSX.Element {
  const [value, setValue] = useState(currentTitle)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(currentTitle)
    setSaving(false)
    setError('')
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 40)
    return () => clearTimeout(timer)
  }, [currentTitle])

  // A failed save keeps the dialog open with the reason beside the field.
  const submit = async (title: string | null): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(chatId, title)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause, 'The title could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (event: FormEvent): Promise<void> => {
    event.preventDefault()
    return submit(value.trim() || null)
  }

  const handleReset = (): Promise<void> => submit(null)

  return (
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
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'chat-rename-error' : undefined}
      />
      {error && <p id="chat-rename-error" className="chat-rename-error" role="alert">{error}</p>}
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
  )
}

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
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="chat-rename-dialog" data-ui="chat.rename-dialog">
        <DialogTitle>Rename conversation</DialogTitle>
        <DialogDescription>
          Enter a custom title for this chat, or reset to use the default title.
        </DialogDescription>
        {open ? (
          <ChatRenameForm
            chatId={chatId}
            currentTitle={currentTitle}
            onClose={onClose}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
