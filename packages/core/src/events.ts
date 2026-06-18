import type { AgentId, EvidenceId, RunActivityKind, RunId, SpecId, SpecStatus, TaskId, TaskStatus } from './types.js'

export interface DuctumEventRecord {
  id: string
  event: DuctumEvent
  ts: string
}

export type DuctumEvent =
  | { type: 'run.stage_changed'; runId: RunId; from: string; to: string; reason?: string }
  | { type: 'run.dispatched'; runId: RunId; taskId: TaskId; agentId: AgentId; agentName: string; stage: string }
  | { type: 'run.awaiting_approval'; runId: RunId }
  | { type: 'run.cancelled'; runId: RunId; reason: string; worktreePreserved: boolean; cleanupAt: string | null }
  | { type: 'run.failed'; runId: RunId; failReason: string | null }
  | { type: 'run.paused'; runId: RunId; reason: string }
  | { type: 'run.frozen'; runId: RunId; reason: string }
  | { type: 'run.quarantined'; runId: RunId; reason: string }
  | { type: 'run.resumed'; runId: RunId; fromRunId: RunId; stage: string }
  | { type: 'run.failed_over'; runId: RunId; fromRunId: RunId; fromAgentId: AgentId; toAgentId: AgentId; reason: string }
  | { type: 'run.completed'; runId: RunId }
  | { type: 'run.evidence_attached'; runId: RunId; evidenceId: EvidenceId }
  | { type: 'run.heartbeat'; runId: RunId }
  | { type: 'run.agent_activity'; runId: RunId; kind: RunActivityKind; content: string; toolName: string | null }
  | { type: 'run.cost_warning'; runId: RunId; costUsd: number; threshold: number }
  | { type: 'cost_budget.paused'; runId: RunId; projectedSpend: number; cap: number; scope: 'run' | 'spec' }
  | { type: 'cost_budget.extended'; runId: RunId; byUsd: number; newCap: number }
  | { type: 'slot.auto_closed'; runId: RunId; reason: string }
  | { type: 'task.status_changed'; taskId: TaskId; from: TaskStatus; to: TaskStatus }
  | { type: 'task.dispatch_skipped'; taskId: TaskId; reason: string; detail?: string }
  | { type: 'spec.status_changed'; specId: SpecId; from: SpecStatus; to: SpecStatus }
  | { type: 'approval.requested'; runId: RunId }
  | { type: 'gate.evaluated'; runId: RunId; gateType: string; result: string }
  | { type: 'workflow.advanced'; runId: RunId; fromStage: string; events: Record<string, unknown>[] }
  | { type: 'factory.events_stream_resumed'; lastEventId: string }

type DuctumListener = (event: DuctumEvent) => void
type DuctumRecordListener = (record: DuctumEventRecord) => void

export class DuctumEventEmitter {
  private sequence = 0
  private readonly historyLimit = 1000
  private readonly history: DuctumEventRecord[] = []
  private readonly listeners = new Set<DuctumListener>()
  private readonly recordListeners = new Set<DuctumRecordListener>()

  subscribe(listener: DuctumListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeRecords(listener: DuctumRecordListener): () => void {
    this.recordListeners.add(listener)
    return () => {
      this.recordListeners.delete(listener)
    }
  }

  emit(event: DuctumEvent): void {
    const record = this.record(event)
    for (const listener of this.listeners) {
      listener(event)
    }
    this.notifyRecordListeners(record)
  }

  record(event: DuctumEvent): DuctumEventRecord {
    const record = {
      id: String(++this.sequence),
      event,
      ts: new Date().toISOString(),
    }
    this.history.push(record)
    if (this.history.length > this.historyLimit) this.history.shift()
    return record
  }

  emitRecord(event: DuctumEvent): DuctumEventRecord {
    const record = this.record(event)
    this.notifyRecordListeners(record)
    return record
  }

  getAfter(lastEventId: string | undefined | null): DuctumEventRecord[] {
    if (lastEventId == null || lastEventId.trim() === '') return [...this.history]
    const last = Number(lastEventId)
    if (!Number.isFinite(last)) return []
    return this.history.filter((record) => Number(record.id) > last)
  }

  lastEventId(): string {
    return String(this.sequence)
  }

  private notifyRecordListeners(record: DuctumEventRecord): void {
    for (const listener of this.recordListeners) {
      listener(record)
    }
  }
}
