import type { StreamEvent } from './stream-types.js'

export interface SSEParserOptions {
  onEvent: (event: StreamEvent) => void
  onError?: (error: Error) => void
  onComment?: (comment: string) => void
}

/**
 * Creates an event-driven SSE stream reader that correctly buffers chunks,
 * handles UTF-8 multi-byte boundary splits, parses SSE data payloads,
 * and recovers gracefully from malformed network chunks.
 */
export function createSSEParser(options: SSEParserOptions) {
  const textDecoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentDataLines: string[] = []

  function processLine(line: string): void {
    // Empty line indicates dispatch of accumulated event
    if (line === '') {
      if (currentDataLines.length > 0) {
        const rawPayload = currentDataLines.join('\n')
        currentDataLines = []
        try {
          const parsed = JSON.parse(rawPayload) as StreamEvent
          options.onEvent(parsed)
        } catch (err) {
          options.onError?.(
            new Error(`Failed to parse SSE JSON payload: "${rawPayload}" (${err instanceof Error ? err.message : String(err)})`)
          )
        }
      }
      return
    }

    // SSE Comments start with ':'
    if (line.startsWith(':')) {
      options.onComment?.(line.slice(1).trim())
      return
    }

    // Field: Value
    if (line.startsWith('data:')) {
      const dataContent = line.slice(5).trimStart()
      currentDataLines.push(dataContent)
    }
  }

  return {
    /**
     * Feed an incoming Uint8Array chunk from a ReadableStream reader.
     */
    feed(chunk: Uint8Array): void {
      buffer += textDecoder.decode(chunk, { stream: true })
      const lines = buffer.split(/\r\n|\r|\n/)
      // Keep the last incomplete fragment in the buffer
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        processLine(line)
      }
    },

    /**
     * Feed a string chunk directly (for simulated or already-decoded streams).
     */
    feedString(text: string): void {
      buffer += text
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        processLine(line)
      }
    },

    /**
     * Flush any remaining buffered content when the stream closes.
     */
    flush(): void {
      if (buffer.length > 0) {
        processLine(buffer)
        buffer = ''
      }
      if (currentDataLines.length > 0) {
        processLine('')
      }
    }
  }
}

/**
 * Async generator utility that consumes a browser/Node ReadableStream<Uint8Array>
 * and yields strongly-typed StreamEvent objects.
 */
export async function* consumeSSEStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent, void, unknown> {
  const reader = stream.getReader()
  const queue: StreamEvent[] = []
  let streamError: Error | null = null

  const parser = createSSEParser({
    onEvent: (event) => queue.push(event),
    onError: (err) => {
      streamError = err
    }
  })

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) break

      if (value) {
        parser.feed(value)
      }

      while (queue.length > 0) {
        yield queue.shift()!
      }

      if (streamError) {
        throw streamError
      }
    }

    parser.flush()
    while (queue.length > 0) {
      yield queue.shift()!
    }
  } finally {
    reader.releaseLock()
  }
}
