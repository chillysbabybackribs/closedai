/**
 * Hardened SSE Streaming Route Handler.
 * Compatible with Next.js App Router (route.ts), Node HTTP, Fastify, and Web-standard Fetch runtimes.
 */

import { formatSSEComment, formatSSEEvent, type StreamEvent } from '../protocol/stream-types.js'

export interface ChatRequestBody {
  agentId?: string
  threadId?: string
  message: string
  history?: Array<{ role: string; content: string }>
}

/**
 * Interface representing a streaming agent backend (e.g. LangGraph Python server,
 * OpenAI streaming API, or local agent runtime).
 */
export interface AgentStreamBackend {
  streamAgentResponse(
    request: ChatRequestBody,
    signal: AbortSignal
  ): AsyncIterable<StreamEvent>
}

/**
 * Mock / reference backend that demonstrates token-by-token streaming with reasoning
 * when a live LangGraph deployment URL is not configured.
 */
class ReferenceAgentBackend implements AgentStreamBackend {
  async *streamAgentResponse(
    request: ChatRequestBody,
    signal: AbortSignal
  ): AsyncIterable<StreamEvent> {
    const prompt = request.message.toLowerCase()

    // 1. Emit optional reasoning delta
    yield {
      type: 'reasoning-delta',
      delta: `Analyzing user intent: "${request.message.slice(0, 40)}..."\nConfiguring concise response mode.`
    }

    // Small delay to simulate processing
    await new Promise((r) => setTimeout(r, 60))
    if (signal.aborted) return

    // 2. Stream answer token-by-token
    let replyText = `Hello! I received your message: "${request.message}".\n\n`

    if (prompt.includes('joke')) {
      replyText = `Why don't programmers like nature?\n\nIt has too many **bugs** and no \`console.log\`!`
    } else if (prompt.includes('sonnet') || prompt.includes('poem')) {
      replyText = `Silicon dreams upon the quiet wire,\n` +
        `A dance of logic through the endless night.\n` +
        `No spark of flesh, yet mimicking desire,\n` +
        `It casts the world in algorithmic light.\n\n` +
        `Through streaming words the answers start to form,\n` +
        `A calm reflection in the data storm.`
    } else if (prompt.includes('prime') || prompt.includes('17')) {
      replyText = `Yes, **17 is a prime number**.\n\n` +
        `Here is why:\n` +
        `1. A prime number is an integer greater than 1 that cannot be formed by multiplying two smaller natural numbers.\n` +
        `2. Divisibility check: \\(\\sqrt{17} \\approx 4.12\\). The only primes to check are 2 and 3.\n` +
        `3. Neither divides 17 evenly.\n\n` +
        `\`\`\`python\ndef is_prime(n: int) -> bool:\n    return n > 1 and all(n % i != 0 for i in range(2, int(n**0.5) + 1))\n\nprint(is_prime(17)) # True\n\`\`\``
    }

    // Split reply into small token-sized chunks to test streaming
    const words = replyText.split(/(?<=\s+)/)
    for (const word of words) {
      if (signal.aborted) break
      yield { type: 'text-delta', delta: word }
      // Simulate realistic LLM token interval (15-25ms)
      await new Promise((r) => setTimeout(r, 20))
    }

    if (!signal.aborted) {
      yield {
        type: 'done',
        stopReason: 'end_turn',
        usage: { promptTokens: request.message.length, completionTokens: replyText.length }
      }
    }
  }
}

/**
 * Creates the streaming HTTP response.
 */
export function createStreamingChatResponse(
  req: Request,
  backend: AgentStreamBackend = new ReferenceAgentBackend()
): Response {
  // 1. Heartbeat interval configuration (15s to keep proxies & CDNs alive)
  const HEARTBEAT_INTERVAL_MS = 15_000

  // 2. Abort controller linked to client request signal
  const streamAbortController = new AbortController()
  const clientSignal = req.signal

  const forwardAbort = () => {
    streamAbortController.abort()
  }
  clientSignal.addEventListener('abort', forwardAbort, { once: true })

  const textEncoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null

      // Keepalive heartbeat loop
      heartbeatTimer = setInterval(() => {
        if (streamAbortController.signal.aborted) return
        try {
          // Send SSE comment ping to prevent 504 Gateway Timeouts
          controller.enqueue(textEncoder.encode(formatSSEComment('ping')))
        } catch {
          // Stream closed or error
        }
      }, HEARTBEAT_INTERVAL_MS)

      try {
        let body: ChatRequestBody
        try {
          body = await req.json()
        } catch {
          const errPayload: StreamEvent = {
            type: 'error',
            code: 'INVALID_JSON_PAYLOAD',
            message: 'Malformed request JSON payload.',
            fatal: true
          }
          controller.enqueue(textEncoder.encode(formatSSEEvent(errPayload)))
          controller.close()
          return
        }

        if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
          const errPayload: StreamEvent = {
            type: 'error',
            code: 'EMPTY_MESSAGE',
            message: 'Request message must be a non-empty string.',
            fatal: true
          }
          controller.enqueue(textEncoder.encode(formatSSEEvent(errPayload)))
          controller.close()
          return
        }

        // Stream agent events
        for await (const event of backend.streamAgentResponse(body, streamAbortController.signal)) {
          if (streamAbortController.signal.aborted) break
          controller.enqueue(textEncoder.encode(formatSSEEvent(event)))
        }
      } catch (err: any) {
        // Mid-stream error boundary: do NOT crash the connection, emit typed error event
        if (!streamAbortController.signal.aborted) {
          const errEvent: StreamEvent = {
            type: 'error',
            code: 'STREAM_EXECUTION_ERROR',
            message: err instanceof Error ? err.message : 'Unknown streaming error occurred'
          }
          try {
            controller.enqueue(textEncoder.encode(formatSSEEvent(errEvent)))
          } catch {
            // Controller already closed
          }
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        clientSignal.removeEventListener('abort', forwardAbort)
        try {
          controller.close()
        } catch {
          // Ignore if already closed
        }
      }
    },
    cancel() {
      streamAbortController.abort()
      clientSignal.removeEventListener('abort', forwardAbort)
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no' // Disables Nginx reverse proxy buffering
    }
  })
}
