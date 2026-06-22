export interface DispatchQueue {
  readonly running: boolean
  start(task: () => void | Promise<void>, intervalMs: number): void
  stop(): void
}

export class InProcessQueue implements DispatchQueue {
  private interval: NodeJS.Timeout | null = null

  get running(): boolean {
    return this.interval != null
  }

  start(task: () => void | Promise<void>, intervalMs: number): void {
    if (this.interval != null) return
    this.interval = setInterval(() => {
      void task()
    }, intervalMs)
  }

  stop(): void {
    if (this.interval != null) clearInterval(this.interval)
    this.interval = null
  }
}
