import { parentPort, workerData } from 'node:worker_threads'
import { ArtifactDatabase, type ArtifactRequest } from './artifact-database.js'

if (!parentPort) throw new Error('Artifact worker requires a parent port')
const port = parentPort
const database = new ArtifactDatabase(workerData.file, workerData.limits)
port.on('message', (message: ArtifactRequest & { requestId: number }) => {
  try {
    const result = database.run(message)
    port.postMessage({ requestId: message.requestId, result })
    if (message.action === 'close') port.close()
  } catch (error) {
    port.postMessage({ requestId: message.requestId, error: error instanceof Error ? error.message : String(error) })
  }
})
