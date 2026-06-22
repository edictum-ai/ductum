import { afterEach, describe, expect, it, vi } from 'vitest'

import { InProcessQueue } from '../dispatch-queue.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('InProcessQueue', () => {
  it('starts once and stops the in-process polling loop', async () => {
    vi.useFakeTimers()
    const queue = new InProcessQueue()
    const task = vi.fn()

    queue.start(task, 100)
    queue.start(task, 100)
    expect(queue.running).toBe(true)

    await vi.advanceTimersByTimeAsync(250)
    expect(task).toHaveBeenCalledTimes(2)

    queue.stop()
    expect(queue.running).toBe(false)
    await vi.advanceTimersByTimeAsync(250)
    expect(task).toHaveBeenCalledTimes(2)
  })
})
