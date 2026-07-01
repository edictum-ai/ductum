import { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildEventStreamUrl } from '@/api/event-stream-url'
import { useDuctumSSE } from '@/api/sse'

describe('SSE hook invalidation logic', () => {
  let queryClient: QueryClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invalidateSpy: any

  beforeEach(() => {
    queryClient = new QueryClient()
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('invalidates run queries on stage change', async () => {
    await queryClient.invalidateQueries({ queryKey: ['runs', 'run_123'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs', 'run_123'] })
  })

  it('invalidates tasks on task status change', async () => {
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
  })

  it('invalidates evidence on attachment', async () => {
    await queryClient.invalidateQueries({ queryKey: ['runs', 'run_123', 'evidence'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs', 'run_123', 'evidence'] })
  })

  it('invalidates approvals on request', async () => {
    await queryClient.invalidateQueries({ queryKey: ['approvals'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['approvals'] })
  })

  it('surfaces EventSource connection state', async () => {
    const original = window.EventSource
    const sources: EventSourceStub[] = []
    window.EventSource = class extends EventSourceStub {
      constructor(url: string | URL) {
        super(url)
        sources.push(this)
      }
    } as unknown as typeof EventSource

    function Probe() {
      const sse = useDuctumSSE()
      return createElement('div', { 'data-testid': 'status' }, sse.status)
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)))

    expect(screen.getByTestId('status')).toHaveTextContent('connecting')
    act(() => { sources[0]?.open() })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    act(() => { sources[0]?.fail() })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('reconnecting'))
    act(() => {
      sources[0]?.close()
      sources[0]?.fail()
    })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('offline'))

    window.EventSource = original
  })

  it('marks ready and ping SSE events as connected', async () => {
    const original = window.EventSource
    const sources: EventSourceStub[] = []
    window.EventSource = class extends EventSourceStub {
      constructor(url: string | URL) {
        super(url)
        sources.push(this)
      }
    } as unknown as typeof EventSource

    function Probe() {
      const sse = useDuctumSSE()
      return createElement('div', { 'data-testid': 'status' }, sse.status)
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)))

    expect(screen.getByTestId('status')).toHaveTextContent('connecting')
    act(() => { sources[0]?.emit('ready') })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))
    act(() => { sources[0]?.fail() })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('reconnecting'))
    act(() => { sources[0]?.emit('ping') })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('connected'))

    window.EventSource = original
  })

  it('invalidates deep-route resolve data when the filtered run heartbeats', async () => {
    const original = window.EventSource
    const sources: EventSourceStub[] = []
    window.EventSource = class extends EventSourceStub {
      constructor(url: string | URL) {
        super(url)
        sources.push(this)
      }
    } as unknown as typeof EventSource

    function Probe() {
      const sse = useDuctumSSE({ runId: 'run_123' })
      return createElement('div', { 'data-testid': 'status' }, sse.status)
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)))
    act(() => { sources[0]?.emit('run.heartbeat', { runId: 'run_123' }) })

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs', 'run_123'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['resolve'] })
    })

    window.EventSource = original
  })

  it('builds same-origin EventSource URLs with filters only', () => {
    expect(buildEventStreamUrl({ runId: 'run 1', projectId: 'ductum' })).toBe(
      '/api/events/stream?runId=run+1&projectId=ductum',
    )
  })
})

class EventSourceStub {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readonly url: string
  readyState = EventSourceStub.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, Array<(event: { data: string }) => void>>()

  constructor(url: string | URL) {
    this.url = String(url)
  }

  addEventListener(event: string, handler: (event: { data: string }) => void) {
    const current = this.listeners.get(event) ?? []
    current.push(handler)
    this.listeners.set(event, current)
  }
  removeEventListener() {}

  open() {
    this.readyState = EventSourceStub.OPEN
    this.onopen?.()
  }

  fail() {
    this.onerror?.()
  }

  close() {
    this.readyState = EventSourceStub.CLOSED
  }

  emit(event: string, data: unknown = {}) {
    this.readyState = EventSourceStub.OPEN
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    for (const handler of this.listeners.get(event) ?? []) handler({ data: payload })
  }
}
