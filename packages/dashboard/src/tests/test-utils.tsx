import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { TooltipProvider } from '@/components/ui/tooltip'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {},
) {
  const queryClient = createTestQueryClient()
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    )
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient }
}

type MockResponse =
  | unknown
  | { __status: number; body?: unknown }
  | ((ctx: { url: string; init?: RequestInit }) => unknown)

const METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE)\s+/

/**
 * URL-substring fetch mock. Patterns may carry a method prefix
 * (`'PATCH /api/factory/settings'`) to disambiguate verbs on one URL;
 * bare patterns match any method. Responses may be functions of
 * `{ url, init }` for stateful flows (e.g. delete-then-refetch).
 */
export function mockFetch(responses: Record<string, MockResponse>) {
  const original = globalThis.fetch
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const sorted = Object.entries(responses).sort((a, b) => b[0].length - a[0].length)
    for (const [pattern, data] of sorted) {
      const methodMatch = METHOD_PATTERN.exec(pattern)
      if (methodMatch != null && methodMatch[1] !== method) continue
      const urlPattern = methodMatch == null ? pattern : pattern.slice(methodMatch[0].length)
      if (!url.includes(urlPattern)) continue
      const resolved = typeof data === 'function' ? data({ url, init }) : data
      if (isMockStatus(resolved)) {
        const ok = resolved.__status < 400
        const body = resolved.body ?? (ok ? null : { error: 'Request failed' })
        return Promise.resolve({
          ok,
          status: resolved.__status,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(resolved),
        text: () => Promise.resolve(JSON.stringify(resolved)),
      } as Response)
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not found') } as Response)
  })
  globalThis.fetch = mock
  return { mock, restore: () => { globalThis.fetch = original } }
}

function isMockStatus(value: unknown): value is { __status: number; body?: unknown } {
  return typeof value === 'object' && value != null && '__status' in value
}

/** Fetch-mock calls matching a method + URL substring. */
export function callsOf(helper: ReturnType<typeof mockFetch>, method: string, urlPart: string) {
  return helper.mock.mock.calls.filter(([input, init]) => {
    return String(input).includes(urlPart) && (init?.method ?? 'GET').toUpperCase() === method
  })
}

/** Parse the JSON body a fetch-mock call was made with. */
export function requestBody(call: [RequestInfo | URL, RequestInit?]): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>
}
