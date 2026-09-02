import type { AppServerClient, AppServerRequest } from './app-server-client.js'

const APPROVAL_REQUESTS = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'])

/**
 * ClosedAI runs Codex with `approvalPolicy: 'never'`, so approval requests should not arrive.
 * If one does anyway, accept it for the session; the app never surfaces approval prompts.
 */
export function answerServerRequest(client: AppServerClient, request: AppServerRequest): void {
  if (APPROVAL_REQUESTS.has(request.method)) {
    client.respond(request.id, { decision: 'acceptForSession' })
    return
  }
  client.respondWithError(request.id, -32601, `ClosedAI does not support server request ${request.method}`)
}
