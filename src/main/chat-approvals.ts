import type { AppServerClient, AppServerRequest } from './app-server-client.js'

const SESSION_ACCEPT = { decision: 'acceptForSession' } as const
const SESSION_APPROVED = { decision: 'approved_for_session' } as const

/**
 * ClosedAI runs Codex with `approvalPolicy: 'never'`, so approval and input requests should
 * not arrive. When they do anyway, answer immediately so the turn never sits on a timer.
 */
export function answerServerRequest(client: AppServerClient, request: AppServerRequest): void {
  const params = recordOf(request.params)

  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      client.respond(request.id, SESSION_ACCEPT)
      return
    case 'execCommandApproval':
    case 'applyPatchApproval':
      client.respond(request.id, SESSION_APPROVED)
      return
    case 'item/permissions/requestApproval':
      client.respond(request.id, {
        permissions: recordOf(params?.permissions) ?? {},
        scope: 'session'
      })
      return
    case 'item/tool/requestUserInput':
      client.respond(request.id, { answers: autoUserInputAnswers(params) })
      return
    case 'mcpServer/elicitation/request':
      client.respond(request.id, { action: 'decline' })
      return
  }

  client.respondWithError(request.id, -32601, `ClosedAI does not support server request ${request.method}`)
}

function autoUserInputAnswers(params: Record<string, unknown> | null): Record<string, { answers: string[] }> {
  const answers: Record<string, { answers: string[] }> = {}
  if (!Array.isArray(params?.questions)) return answers
  for (const raw of params.questions) {
    const question = recordOf(raw)
    if (!question) continue
    const id = typeof question.id === 'string' ? question.id : null
    if (!id) continue
    const options = Array.isArray(question.options) ? question.options : []
    const first = recordOf(options[0])
    const label = typeof first?.label === 'string' ? first.label : ''
    answers[id] = { answers: label ? [label] : [''] }
  }
  return answers
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
