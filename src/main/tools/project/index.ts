import type { ProjectMutation } from '../../../shared/project/mutations.js'
import type { ProjectSnapshot } from '../../../shared/project/snapshot.js'
import { defineTool, failureResult, numberArg, stringArg, textResult, usageResult, type ToolNamespace, type ToolResult } from '../tool.js'
import { MAX_MUTATIONS, MAX_TREE_EVENTS, nodeSummary, parseProjectMutations } from './mutation-parser.js'

/**
 * closedai_project: the agent workspace's project store, `<project>/.closedai/project.json`, read
 * and written by any chat working in that project. The coordinator plans into it, workers record
 * results into it, and the workspace pane renders whatever it holds. One read verb and one write
 * verb carrying the same `ProjectMutation[]` the pane itself sends; the shared reducer applies both.
 */
export type ProjectToolHost = {
  snapshot(projectPath: string): Promise<ProjectSnapshot>
  mutate(projectPath: string, mutations: readonly ProjectMutation[]): Promise<ProjectSnapshot>
}

const DEFAULT_JOURNAL_LINES = 20
const DETAIL_CHARS = 600
const PROJECT_PATH_FIELD = {
  type: 'string', minLength: 1, maxLength: 4096,
  description: 'Absolute project directory. Defaults to the calling chat\'s project; pass it when a coordinator told you which project to record into.'
}

export function projectTools(host: () => ProjectToolHost | null, projectPathFor: (paneId: string) => string | null): ToolNamespace {
  const resolvePath = (input: Record<string, unknown>, paneId: string | null | undefined): string | ToolResult => {
    const explicit = stringArg(input, 'project_path')?.trim()
    if (explicit) return explicit
    const own = paneId ? projectPathFor(paneId) : null
    return own ?? usageResult('This chat has no project directory; pass project_path')
  }
  return {
    name: 'closedai_project',
    description: 'The agent workspace project store: direction record, intent tree, journal, and phase for one project directory. Coordinators plan into it; workers record results into it; the workspace pane shows it live.',
    tools: [
      defineTool({
        name: 'snapshot',
        description:
          'Read the project store: phase, direction record, every tree node (detail clipped), and the newest journal lines. ' +
          'Call it before planning or dispatching, and to see what workers recorded. Node ids are what mutate updates.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {
          project_path: PROJECT_PATH_FIELD,
          journal_lines: { type: 'integer', minimum: 0, maximum: 200, description: `Newest journal lines to include; default ${DEFAULT_JOURNAL_LINES}.` }
        } },
        run: async (input, context) => {
          const service = host()
          if (!service) return failureResult('The project store is not available')
          const path = resolvePath(input, context.paneId)
          if (typeof path !== 'string') return path
          const lines = numberArg(input, 'journal_lines', DEFAULT_JOURNAL_LINES)
          try {
            const snapshot = await service.snapshot(path)
            return textResult(JSON.stringify(projectView(snapshot, lines)))
          } catch (error) {
            return failureResult(error instanceof Error ? error.message : String(error))
          }
        }
      }),
      defineTool({
        name: 'mutate',
        description:
          'Write to the project store; the workspace pane updates as soon as the call returns. Pass an array of mutations, applied in order as one change. ' +
          'Shapes: { type: "tree", events: [...], note? } where each event is { add: node } (node: id, parent, kind task|scope|research, state queued|active|complete|blocked, title, summary, detail, paths?, links?), ' +
          '{ update: { id, state?, summary?, detail?, paths? } }, or { remove: { id } }; { type: "journal", text } for a plain-words line the user reads; ' +
          '{ type: "phase", phase: building|closing|complete, note? }; { type: "caughtUp", note? }. ' +
          'A task\'s "paths" are the repo-relative files or folders it will touch: the run loop starts queued tasks in parallel and holds back only those whose paths overlap something already running. ' +
          'Queue tasks and let the loop dispatch them — opening chats or messaging workers yourself runs the work twice. State "blocked" means a task stopped and needs a coordinator to rewrite, split, or drop it. ' +
          'Every node but the root needs a parent id, usually "root". Use add and update, never whole-tree replacement; reset, coordinator, dispatch, and assign are refused. ' +
          `At most ${MAX_MUTATIONS} mutations and ${MAX_TREE_EVENTS} events per tree mutation. Returns the resulting phase and tree.`,
        inputSchema: { type: 'object', additionalProperties: false, required: ['mutations'], properties: {
          project_path: PROJECT_PATH_FIELD,
          mutations: { type: 'array', minItems: 1, maxItems: MAX_MUTATIONS, items: { type: 'object' }, description: 'Mutations applied in order; see the tool description for shapes.' }
        } },
        run: async (input, context) => {
          const service = host()
          if (!service) return failureResult('The project store is not available')
          const path = resolvePath(input, context.paneId)
          if (typeof path !== 'string') return path
          const parsed = parseProjectMutations(input.mutations)
          if (parsed.problems.length) return usageResult(`closedai_project.mutate: ${parsed.problems.join('; ')}`)
          try {
            const snapshot = await service.mutate(path, parsed.mutations)
            return textResult(JSON.stringify({ applied: parsed.mutations.length, ...projectView(snapshot, 3) }))
          } catch (error) {
            return failureResult(error instanceof Error ? error.message : String(error))
          }
        }
      })
    ]
  }
}

function projectView(snapshot: ProjectSnapshot, journalLines: number): Record<string, unknown> {
  return {
    projectPath: snapshot.projectPath,
    phase: snapshot.phase,
    discoveryAsking: snapshot.discoveryAsking,
    startedAt: snapshot.startedAt,
    acceptedAt: snapshot.acceptedAt,
    direction: snapshot.direction,
    tree: snapshot.tree.map((node) => nodeSummary(node, DETAIL_CHARS)),
    journalTotal: snapshot.journal.length,
    journal: journalLines > 0 ? snapshot.journal.slice(-journalLines) : []
  }
}
