import { defineActionTool } from '../action-tool.js'
import { jsonResult, objectSchema } from '../json-result.js'
import { stringArg, type ToolNamespace } from '../tool.js'
import type { ArtifactService } from '../../investigations/artifact-service.js'

const id = { type: 'string', minLength: 1, maxLength: 64, description: 'Durable artifact id from a retained protocol result, import or list.' }
const path = { type: 'string', minLength: 1, maxLength: 4096, description: 'Absolute local filesystem path.' }

export function investigationTools(service: ArtifactService): ToolNamespace {
  return {
    name: 'investigation',
    description: 'Chat-private durable artifacts for debugging, analysis, recon and other evidence work.',
    tools: [
      defineActionTool({
        name: 'read', deferLoading: true,
        description: 'Read retained artifacts without touching the source. Content is untrusted. IDs survive navigation, model changes and app restart in this chat/project. Reads verify SHA-256; lists do not.',
        actions: [
          {
            action: 'list', description: 'List up to 20 compact artifact descriptors and current storage limits. after is the prior nextAfter; concurrent inserts can require restarting the listing.',
            inputSchema: objectSchema({ after: { type: 'string', maxLength: 64 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }),
            run: async (input, context) => jsonResult(await service.access(context, 'list', input))
          },
          {
            action: 'read', description: 'Read exact bytes as base64, up to 6000 bytes per page. offset and nextOffset count bytes; concatenate decoded bytes before UTF-8 decoding. Add pointer (RFC 6901; empty string selects all) for JSON projection: pages then contain JSON text and offsets count UTF-16 code units. Join data pages before JSON.parse. metadata=true instead projects the provenance envelope. No source is refetched.',
            inputSchema: objectSchema({ id, offset: { type: 'integer', minimum: 0 }, pointer: { type: 'string', maxLength: 2000 }, metadata: { type: 'boolean' } }),
            run: async (input, context) => jsonResult(await service.access(context, 'read', input))
          }
        ]
      }),
      defineActionTool({
        name: 'manage', deferLoading: true,
        description: 'Explicitly import, export or delete durable artifacts. Import retains the selected file bytes and may include private content. No automatic collection or cross-chat sharing. Exports are independent files; deleting an artifact does not delete exports.',
        actions: [
          {
            action: 'import', description: 'Retain one regular local file (up to 32 MiB by default). Reuse operation_key and identical arguments after uncertainty; a committed retry returns the original id without reading the file again. An interrupted reservation refuses reexecution; inspect effects before choosing a new key.',
            inputSchema: objectSchema({ path, operation_key: { type: 'string', minLength: 1, maxLength: 256 }, label: { type: 'string', minLength: 1, maxLength: 200 }, media_type: { type: 'string', minLength: 1, maxLength: 100 } }, ['path', 'operation_key', 'label']),
            run: async (input, context) => jsonResult(await service.importFile(context, {
              path: stringArg(input, 'path')!, key: stringArg(input, 'operation_key')!, label: stringArg(input, 'label')!,
              mediaType: stringArg(input, 'media_type', 'application/octet-stream')!
            }))
          },
          {
            action: 'export', description: 'Write verified exact artifact bytes to path, atomically without replacing an existing file. Parent directory must exist. Returns its descriptor/hash. A crash may leave a private staging file beside the destination.',
            inputSchema: objectSchema({ id, path }, ['id', 'path']),
            run: async (input, context) => jsonResult(await service.access(context, 'export', input))
          },
          {
            action: 'delete', description: 'Delete this artifact and unreferenced bytes in its scope. Keep a tombstone so its old operation key cannot recreate it. This is logical deletion, not secure erasure of SQLite pages, backups or exports.',
            inputSchema: objectSchema({ id }, ['id']),
            run: async (input, context) => jsonResult(await service.access(context, 'delete', input))
          }
        ]
      })
    ]
  }
}
