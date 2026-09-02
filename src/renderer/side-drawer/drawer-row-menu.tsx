import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitBranch } from 'lucide-react'
import type { ChatModel } from '../../shared/chat.js'
import { placeRowMenu, type MenuPlacement } from './drawer-row-position.js'

export type RowMenuTarget = { id: string; title: string; model?: string; x: number; y: number }

const MENU_WIDTH = 208
const MENU_MAX_HEIGHT = 460

export function DrawerRowMenu({
  target,
  inheritedModel,
  models,
  onFork,
  onClose
}: {
  target: RowMenuTarget
  inheritedModel: string | null
  models: ChatModel[]
  onFork: (modelId: string | null) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = (): void => {
      setPlacement(placeRowMenu(
        { x: target.x, y: target.y },
        { width: node.offsetWidth || MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT },
        { width: window.innerWidth, height: window.innerHeight }
      ))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [target.x, target.y])

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const closeOnKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnKeyDown)
    }
  }, [onClose])

  const codexModels = models.filter((m) => m.provider === 'codex')
  const claudeModels = models.filter((m) => m.provider === 'claude')

  return createPortal(
    <div
      ref={ref}
      className="agents-row-menu"
      role="menu"
      aria-label={`Actions for ${target.title}`}
      style={
        placement
          ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
          : { left: target.x, top: target.y, visibility: 'hidden' }
      }
    >
      <div className="agents-row-menu-heading">
        <GitBranch size={11} aria-hidden="true" />
        <span>Review in a new chat</span>
      </div>
      <p className="agents-row-menu-note">
        Opens an empty chat that reads this one and reports back. Nothing is sent until you
        send it.
      </p>
      <button
        type="button"
        role="menuitem"
        className="agents-row-menu-item"
        onClick={() => onFork(inheritedModel)}
      >
        <span>Same model</span>
        {inheritedModel ? <span className="agents-row-menu-model">{inheritedModel}</span> : null}
      </button>

      {codexModels.length > 0 && (
        <div className="agents-row-menu-group">
          <div className="agents-row-menu-group-label">Codex</div>
          {codexModels.map((m) => (
            <button
              type="button"
              role="menuitem"
              className={`agents-row-menu-item ${m.id === inheritedModel ? 'is-inherited' : ''}`}
              key={m.id}
              onClick={() => onFork(m.id)}
              title={m.description}
            >
              <span>{m.displayName}</span>
              {m.id === inheritedModel ? (
                <span className="agents-row-menu-model">source</span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {claudeModels.length > 0 && (
        <div className="agents-row-menu-group">
          <div className="agents-row-menu-group-label">Claude</div>
          {claudeModels.map((m) => (
            <button
              type="button"
              role="menuitem"
              className={`agents-row-menu-item ${m.id === inheritedModel ? 'is-inherited' : ''}`}
              key={m.id}
              onClick={() => onFork(m.id)}
              title={m.description}
            >
              <span>{m.displayName}</span>
              {m.id === inheritedModel ? (
                <span className="agents-row-menu-model">source</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
