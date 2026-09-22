// Adapters from the app's services to the two narrow surfaces the run loop needs. Keeping them
// here means agent-runner.ts never imports Electron or the peer manager, so the loop can be
// driven by fakes in a test at the same interface the app uses.

import type { ChatWorkspaceEvent } from '../../shared/chat-peers.js'
import type { ProjectWorkspaceEvent } from '../../shared/project/events.js'
import type { ProjectMutation } from '../../shared/project/mutations.js'
import type { ProjectSnapshot } from '../../shared/project/snapshot.js'
import type { ChatPeerManager } from '../chat-peers/peer-manager.js'
import type { ProjectHub } from '../project-store/project-hub.js'
import type { RunnerChat, RunnerStore } from './agent-runner.js'
import type { PaneState } from './runner-plan.js'

export function runnerStore(hub: ProjectHub): RunnerStore {
  return {
    snapshot: (projectPath: string): Promise<ProjectSnapshot> => hub.snapshot(projectPath),
    mutate: (projectPath: string, mutations: readonly ProjectMutation[]): Promise<ProjectSnapshot> =>
      hub.mutate(projectPath, mutations),
    on: (listener) => {
      const handler = (event: ProjectWorkspaceEvent): void => {
        if (event.type === 'snapshot') listener(event.snapshot)
      }
      hub.on('event', handler)
      return () => { hub.off('event', handler) }
    }
  }
}

export function runnerChat(chat: ChatPeerManager): RunnerChat {
  return {
    paneState: (paneId: string): PaneState => chat.paneActivity(paneId),
    newWorker: (parentPaneId: string): Promise<string> => chat.newWorkerPeer(parentPaneId),
    send: (paneId: string, text: string): Promise<void> => chat.send(paneId, text, []),
    on: (listener) => {
      const handler = (event: ChatWorkspaceEvent): void => { listener(event) }
      chat.on('event', handler)
      return () => { chat.off('event', handler) }
    }
  }
}
