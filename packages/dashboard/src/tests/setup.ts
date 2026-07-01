import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

import { cancelPendingLastSeenWrite } from '@/components/homepage/HomepageTodayPanel'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const localStorageMock = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

// jsdom needs matchMedia for useMediaQuery hook
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// EventSource mock for SSE tests
class EventSourceMock {
  url: string
  readyState = 0
  onmessage: (() => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  constructor(url: string) { this.url = url }
  addEventListener() {}
  removeEventListener() {}
  close() {}
  dispatchEvent() { return false }
}
window.EventSource = EventSourceMock as unknown as typeof EventSource

// ResizeObserver mock for jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

// setup.ts loads before tests import RTL, so this runs after RTL cleanup.
// That prevents Home's delayed unmount write from leaking into the next test.
afterEach(() => {
  cancelPendingLastSeenWrite()
})
