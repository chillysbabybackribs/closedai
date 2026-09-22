import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import { emptyDirectionRecord, type DirectionRecord } from '../../shared/project/direction.js'
import type { ProjectPeersSnapshot } from '../../shared/project-peers.js'
import { clip } from '../preview/project-discovery.js'
import type { Message } from '../preview/project-intake.js'
import { sendAndWaitForPaneTurn } from './wait-pane-turn.js'

const INTAKE_START_READY = /start building/i

export function upsertProjectAssistantMessage(options: {
  itemId: string
  text: string
  appended?: boolean
  itemIds: Map<string, number>
  nextId: MutableRefObject<number>
  setMessages: Dispatch<SetStateAction<Message[]>>
}): void {
  const { itemId, text, appended, itemIds, nextId, setMessages } = options
  const existingId = itemIds.get(itemId)
  if (existingId != null) {
    setMessages((current) => current.map((message) =>
      message.id === existingId ? { ...message, text } : message))
    return
  }
  if (!appended && !text.trim()) return
  // Keep ref mutations outside the state updater: React Strict Mode may invoke an updater twice.
  const id = nextId.current++
  itemIds.set(itemId, id)
  setMessages((current) => current.some((message) => message.id === id)
    ? current.map((message) => message.id === id ? { ...message, text } : message)
    : [...current, { id, at: Date.now(), role: 'coordinator', text }])
}

export function liveIntakeReady(messages: Message[]): boolean {
  const last = [...messages].reverse().find((message) => message.role === 'coordinator')
  return last ? INTAKE_START_READY.test(last.text) : false
}

export function directionFromIntake(messages: Message[]): DirectionRecord {
  const users = messages.filter((message) => message.role === 'user').map((message) => message.text)
  const summary = [...messages].reverse().find((message) => message.role === 'coordinator')?.text ?? ''
  const base = emptyDirectionRecord()
  return {
    ...base,
    idea: users[0]?.trim() || clip(summary, 240) || 'Project direction from intake',
    user: users[1]?.trim() || null,
    journey: users[2]?.trim() || null,
    boundaries: users[3]?.trim() || null,
    refinements: summary ? [`Intake coordinator summary: ${clip(summary, 360)}`] : []
  }
}

export function useProjectPeerChatEvents(options: {
  liveModels: boolean
  projectPeers: ProjectPeersSnapshot | null
  phase: 'intake' | 'canvas'
  nextId: MutableRefObject<number>
  setMessages: Dispatch<SetStateAction<Message[]>>
}): { streamItemToMessageId: MutableRefObject<Map<string, number>>; pendingCoordinatorReply: MutableRefObject<string> } {
  const streamItemToMessageId = useRef(new Map<string, number>())
  const pendingCoordinatorReply = useRef('')
  const { liveModels, projectPeers, phase, nextId, setMessages } = options

  useEffect(() => {
    if (!liveModels || !projectPeers) return
    const { intakePaneId, coordinatorPaneId } = projectPeers
    const upsertAssistant = (paneId: string, itemId: string, text: string, appended?: boolean) => {
      if (phase === 'intake' && paneId === intakePaneId) {
        upsertProjectAssistantMessage({
          itemId,
          text,
          appended,
          itemIds: streamItemToMessageId.current,
          nextId,
          setMessages
        })
        return
      }
      if (phase === 'canvas' && paneId === coordinatorPaneId) pendingCoordinatorReply.current = text
    }
    return window.closedai.chat.onEvent((event) => {
      if (event.type !== 'pane') return
      const { paneId: eventPaneId, event: paneEvent } = event
      if (eventPaneId !== intakePaneId && eventPaneId !== coordinatorPaneId) return
      if (paneEvent.type === 'item' && paneEvent.item.type === 'assistant') {
        upsertAssistant(eventPaneId, paneEvent.item.id, paneEvent.item.text, paneEvent.appended)
      }
      if (paneEvent.type === 'itemDelta' && paneEvent.field === 'text') {
        const messageId = streamItemToMessageId.current.get(paneEvent.itemId)
        if (phase === 'intake' && eventPaneId === intakePaneId && messageId != null) {
          setMessages((current) => current.map((message) =>
            message.id === messageId ? { ...message, text: message.text + paneEvent.delta } : message))
        } else if (phase === 'canvas' && eventPaneId === coordinatorPaneId) {
          pendingCoordinatorReply.current += paneEvent.delta
        }
      }
    })
  }, [liveModels, projectPeers, phase, nextId, setMessages])

  return { streamItemToMessageId, pendingCoordinatorReply }
}

export async function sendLiveIntakeTurn(paneId: string, text: string, streamItemToMessageId: MutableRefObject<Map<string, number>>): Promise<void> {
  streamItemToMessageId.current.clear()
  await sendAndWaitForPaneTurn(paneId, text)
}

export async function sendLiveCoordinatorTurn(
  paneId: string,
  text: string,
  pendingCoordinatorReply: MutableRefObject<string>
): Promise<string> {
  pendingCoordinatorReply.current = ''
  await sendAndWaitForPaneTurn(paneId, text)
  return pendingCoordinatorReply.current.trim()
}
