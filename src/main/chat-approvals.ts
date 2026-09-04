import type { AppServerClient, AppServerRequest } from './app-server-client.js'
import { recordOf } from './json-coerce.js'

const SESSION_ACCEPT = { decision: 'acceptForSession' } as const
const SESSION_APPROVED = { decision: 'approved_for_session' } as const

/**
 * ClosedAI runs Codex with `approvalPolicy: 'never'`, so approval requests should not arrive;
 * when they do anyway, answer immediately so the turn never sits on a timer. User-input
 * requests can arrive from any model and are answered with an explicit "nobody answered".
 */
export function answerServerRequest(
  client: Pick<AppServerClient, 'respond' | 'respondWithError'>,
  request: AppServerRequest
): void {
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

/**
 * ClosedAI has no UI for request_user_input, and silently picking the first option would
 * let the model act on a choice the user never made. Answer every question with the same
 * explicit text instead, so the model knows nobody answered and asks in its final message.
 */
export const USER_INPUT_UNAVAILABLE =
  'ClosedAI could not show this question to the user (request_user_input has no UI here). ' +
  'Nobody answered it. If the choice materially changes the result, stop and ask in your final ' +
  'message; otherwise proceed with the most reasonable default and state the assumption clearly.'

function autoUserInputAnswers(params: Record<string, unknown> | null): Record<string, { answers: string[] }> {
  const answers: Record<string, { answers: string[] }> = {}
  if (!Array.isArray(params?.questions)) return answers
  for (const raw of params.questions) {
    const question = recordOf(raw)
    const id = typeof question?.id === 'string' ? question.id : null
    if (id) answers[id] = { answers: [USER_INPUT_UNAVAILABLE] }
  }
  return answers
}
