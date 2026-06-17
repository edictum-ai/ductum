interface EventStreamFilters {
  runId?: string
  taskId?: string
  specId?: string
  projectId?: string
}

export function buildEventStreamUrl(filters: EventStreamFilters = {}, operatorToken?: string | null) {
  const params = new URLSearchParams()
  if (filters.runId) params.set('runId', filters.runId)
  if (filters.taskId) params.set('taskId', filters.taskId)
  if (filters.specId) params.set('specId', filters.specId)
  if (filters.projectId) params.set('projectId', filters.projectId)

  const token = operatorToken?.trim()
  if (token != null && token !== '') params.set('ductum_operator_token', token)

  return `/api/events/stream${params.toString() ? `?${params}` : ''}`
}

export function readStoredOperatorToken() {
  return globalThis.localStorage?.getItem('ductum.operatorToken') ?? ''
}
