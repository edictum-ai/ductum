import type { Decision, Evidence, Run, RunUpdate, Task } from '@ductum/core'

import type { AcceptedTaskRun, ApiErrorPayload, GateCheckResult, RunContext } from './types.js'

export interface DuctumApi {
  nextTask(project?: string, role?: string): Promise<Task | null>
  getTask(taskId: string): Promise<Task>
  accept(taskId: string): Promise<AcceptedTaskRun>
  complete(runId: string, result: string, pr?: string): Promise<Run>
  update(runId: string, message: string): Promise<RunUpdate>
  heartbeat(runId: string): Promise<Run>
  decide(runId: string, decision: string, context: string, alternatives?: string[]): Promise<Decision>
  gateCheck(runId: string): Promise<GateCheckResult>
  getWorkflowInfo(runId: string): Promise<Record<string, unknown>>
  fail(runId: string, reason: string, recoverable?: boolean): Promise<Run>
  evidence(runId: string, type: string, payload: object): Promise<Evidence>
  link(runId: string, opts: { branch?: string; commit?: string; pr?: string }): Promise<Run>
  getContext(taskId: string): Promise<RunContext>
  postActivity(runId: string, kind: string, content: string, toolName?: string): Promise<void>
  /**
   * Manual fallback for clean session termination. `/complete` already
   * requests teardown server-side; this remains available for operator
   * nudges and backward-compatible callers. Best-effort: no error is
   * thrown if the run has no live session.
   */
  endSession(runId: string): Promise<void>
  setControlToken?(controlToken: string | null): void
}

const SESSION_CONTROL_TOKEN_HEADER = 'x-ductum-control-token'

export class DuctumApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DuctumApiError'
  }
}

export class DuctumApiClient implements DuctumApi {
  private readonly baseUrl: string
  private controlToken: string | null

  constructor(baseUrl: string, options: { controlToken?: string | null } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.controlToken = options.controlToken?.trim() === '' ? null : (options.controlToken ?? null)
  }

  setControlToken(controlToken: string | null): void {
    this.controlToken = controlToken?.trim() === '' ? null : controlToken
  }

  async nextTask(project?: string, role?: string): Promise<Task | null> {
    return this.request<Task | null>('/api/runs/next-task', {
      method: 'POST',
      body: { ...(project == null ? {} : { projectId: project }), ...(role == null ? {} : { role }) },
    })
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/api/tasks/${encodeURIComponent(taskId)}`)
  }

  async accept(taskId: string): Promise<AcceptedTaskRun> {
    const task = await this.getTask(taskId)
    if (task.assignedAgentId == null) {
      throw new Error(`Task ${taskId} does not have an assigned agent`)
    }

    const run = await this.request<Run>('/api/runs/accept', {
      method: 'POST',
      body: {
        taskId,
        agentId: task.assignedAgentId,
      },
    })

    return { run, task }
  }

  async complete(runId: string, result: string, pr?: string): Promise<Run> {
    if (pr != null && pr !== '') {
      await this.link(runId, { pr })
    }

    const run = await this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/complete`, {
      method: 'POST',
      body: { result },
    })

    // `/complete` already asks the API server to tear down the live
    // session. This duplicate nudge keeps the happy path working even
    // if that server-side callback is unavailable or races a slow
    // response flush. Best-effort only: an already-ended session is a
    // normal no-op.
    setImmediate(() => {
      void this.endSession(runId).catch(() => undefined)
    })

    return run
  }

  async update(runId: string, message: string): Promise<RunUpdate> {
    const response = await this.request<{ runId: string; update: RunUpdate }>(
      `/api/runs/${encodeURIComponent(runId)}/update`,
      {
        method: 'POST',
        body: { message },
      },
    )

    return response.update
  }

  async heartbeat(runId: string): Promise<Run> {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/heartbeat`, {
      method: 'POST',
    })
  }

  async decide(
    runId: string,
    decision: string,
    context: string,
    alternatives?: string[],
  ): Promise<Decision> {
    return this.request<Decision>(`/api/runs/${encodeURIComponent(runId)}/decide`, {
      method: 'POST',
      body: { decision, context, ...(alternatives == null ? {} : { alternatives }) },
    })
  }

  async gateCheck(runId: string): Promise<GateCheckResult> {
    return this.request<GateCheckResult>(`/api/runs/${encodeURIComponent(runId)}/gate-check`, {
      method: 'POST',
      body: {},
    })
  }

  async getWorkflowInfo(runId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/runs/${encodeURIComponent(runId)}/workflow`)
  }

  async fail(runId: string, reason: string, recoverable?: boolean): Promise<Run> {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/fail`, {
      method: 'POST',
      body: { reason, ...(recoverable == null ? {} : { recoverable }) },
    })
  }

  async evidence(runId: string, type: string, payload: object): Promise<Evidence> {
    return this.request<Evidence>(`/api/runs/${encodeURIComponent(runId)}/evidence`, {
      method: 'POST',
      body: { type, payload },
    })
  }

  async link(runId: string, opts: { branch?: string; commit?: string; pr?: string }): Promise<Run> {
    return this.request<Run>(`/api/runs/${encodeURIComponent(runId)}/link`, {
      method: 'POST',
      body: opts,
    })
  }

  async getContext(taskId: string): Promise<RunContext> {
    return this.request<RunContext>(`/api/tasks/${encodeURIComponent(taskId)}/context`)
  }

  async postActivity(runId: string, kind: string, content: string, toolName?: string): Promise<void> {
    await this.request<void>(`/api/runs/${encodeURIComponent(runId)}/activity`, {
      method: 'POST',
      body: { kind, content, ...(toolName != null ? { toolName } : {}) },
    }).catch(() => undefined) // best-effort
  }

  async endSession(runId: string): Promise<void> {
    await this.request<void>(`/api/runs/${encodeURIComponent(runId)}/end-session`, {
      method: 'POST',
      body: {},
    })
  }

  private async request<T>(
    path: string,
    init: {
      method?: string
      body?: unknown
    } = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: this.headers(init.body !== undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })

    const text = await response.text()
    const json = text === '' ? null : (JSON.parse(text) as unknown)

    if (!response.ok) {
      const payload = (json ?? {}) as Partial<ApiErrorPayload>
      throw new DuctumApiError(
        typeof payload.error === 'string' ? payload.error : `API request failed with status ${response.status}`,
        response.status,
        payload.details,
      )
    }

    return json as T
  }

  private headers(hasBody: boolean): Record<string, string> | undefined {
    const headers: Record<string, string> = hasBody ? { 'content-type': 'application/json' } : {}
    const token = process.env.DUCTUM_OPERATOR_TOKEN?.trim()
    if (token != null && token !== '' && !isPlaceholderToken(token)) headers['x-ductum-operator-token'] = token
    const controlToken = this.controlToken ?? process.env.DUCTUM_CONTROL_TOKEN?.trim()
    if (controlToken != null && controlToken !== '') headers[SESSION_CONTROL_TOKEN_HEADER] = controlToken
    return Object.keys(headers).length === 0 ? undefined : headers
  }
}

function isPlaceholderToken(token: string): boolean {
  return ['missing', 'changeme', 'replace-me'].includes(token.toLowerCase())
}
