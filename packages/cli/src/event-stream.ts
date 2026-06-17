export interface StreamEvent {
  id?: string
  event: string
  data: string
}

export interface OpenEventStreamInput {
  url: string
  signal: AbortSignal
  headers?: Record<string, string>
}

export type OpenEventStream = (input: OpenEventStreamInput) => AsyncIterable<StreamEvent>

export const openEventStream: OpenEventStream = async function* ({ url, signal, headers }) {
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream', ...(headers ?? {}) },
    signal,
  })

  if (!response.ok || response.body == null) {
    throw new Error(`Event stream request failed: ${response.status} ${response.statusText}`.trim())
  }

  yield* parseEventStream(response, signal)
}

async function* parseEventStream(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const reader = response.body?.getReader()
  if (reader == null) {
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let currentId: string | undefined
  let currentEvent = ''
  let dataLines: string[] = []

  const emit = (): StreamEvent | null => {
    if (currentEvent === '' && dataLines.length === 0) {
      return null
    }
    const next = {
      ...(currentId == null ? {} : { id: currentId }),
      event: currentEvent === '' ? 'message' : currentEvent,
      data: dataLines.join('\n'),
    }
    currentId = undefined
    currentEvent = ''
    dataLines = []
    return next
  }

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (line === '') {
          const event = emit()
          if (event != null) {
            yield event
          }
          continue
        }
        if (line.startsWith(':')) {
          continue
        }
        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trimStart()
          continue
        }
        if (line.startsWith('id:')) {
          currentId = line.slice('id:'.length).trimStart()
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart())
        }
      }
    }

    buffer += decoder.decode()
    if (buffer !== '') {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      if (line.startsWith('event:')) {
        currentEvent = line.slice('event:'.length).trimStart()
      } else if (line.startsWith('id:')) {
        currentId = line.slice('id:'.length).trimStart()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart())
      }
    }
    const event = emit()
    if (event != null) {
      yield event
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error
    }
  } finally {
    reader.releaseLock()
  }
}
