import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GitBranch } from 'lucide-react'
import type { ChatModel } from '../../shared/chat.js'
import { modelGroups } from '../model-menu-state.js'
import { placeRowMenu, type MenuPlacement } from './drawer-row-position.js'

export type RowMenuTarget = {
  id: string
  title: string
  paneId: string | null
  threadId: string | null
  modelId: string | null
  x: number
  y: number
}

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

  const groups = modelGroups(models)

  return createPortal(
    <div
      ref={ref}
      className="agents-row-menu"
      role="menu"
      aria-label={`Actions for ${target.title}`}
      data-ui="drawer.row-menu"
      style={
        placement
          ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
          : { left: target.x, top: target.y, visibility: 'hidden' }
      }
    >
      <div className="agents-row-menu-heading">
        <GitBranch size={11} aria-hidden="true" />
        <span>Continue in a new chat</span>
      </div>
      <p className="agents-row-menu-note">
        Starts a fresh chat with a compact summary of this conversation. The source stays unchanged.
      </p>
      <button
        type="button"
        role="menuitem"
        className="agents-row-menu-item"
        data-ui="drawer.row-menu-item"
        data-ui-key="current"
        onClick={() => onFork(inheritedModel)}
      >
        <span>Current model</span>
        {inheritedModel ? <span className="agents-row-menu-model">{inheritedModel}</span> : null}
      </button>

      {groups.map((group) => (
        <div className="agents-row-menu-group" key={group.provider}>
          <div className="agents-row-menu-group-label">{group.label}</div>
          {group.models.map((m) => (
            <button
              type="button"
              role="menuitem"
              className={`agents-row-menu-item ${m.id === inheritedModel ? 'is-inherited' : ''}`}
              key={m.id}
              data-ui="drawer.row-menu-item"
              data-ui-key={m.id}
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
      ))}
    </div>,
    document.body
  )
}
