import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { buildEventStreamUrl } from './event-stream-url'

interface SSEFilters {
  runId?: string
  taskId?: string
  specId?: string
  projectId?: string
}

export type DuctumSSEStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export function useDuctumSSE(filters?: SSEFilters) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<DuctumSSEStatus>('connecting')

  useEffect(() => {
    let closed = false
    const url = buildEventStreamUrl(filters)
    setStatus('connecting')
    let source: EventSource
    try {
      source = new EventSource(url)
    } catch {
      setStatus('offline')
      return
    }

    source.onopen = () => {
      if (!closed) setStatus('connected')
    }
    source.onerror = () => {
      if (closed) return
      setStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting')
    }
    const markConnected = () => {
      if (!closed) setStatus('connected')
    }

    source.addEventListener('ready', markConnected)
    source.addEventListener('ping', markConnected)

    source.addEventListener('run.stage_changed', (e) => {
      const data = JSON.parse(e.data) as { runId: string }
      void queryClient.invalidateQueries({ queryKey: ['runs', data.runId] })
      void queryClient.invalidateQueries({ queryKey: ['runs'] })
      void queryClient.invalidateQueries({ queryKey: ['resolve'] })
    })

    source.addEventListener('task.status_changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    })

    source.addEventListener('run.evidence_attached', (e) => {
      const data = JSON.parse(e.data) as { runId: string }
      void queryClient.invalidateQueries({ queryKey: ['runs', data.runId, 'evidence'] })
    })

    source.addEventListener('run.heartbeat', (e) => {
      const data = JSON.parse(e.data) as { runId: string }
      void queryClient.invalidateQueries({ queryKey: ['runs', data.runId] })
      if (filters?.runId === data.runId) {
        void queryClient.invalidateQueries({ queryKey: ['resolve'] })
      }
    })

    source.addEventListener('gate.evaluated', (e) => {
      const data = JSON.parse(e.data) as { runId: string }
      void queryClient.invalidateQueries({ queryKey: ['runs', data.runId, 'gate-evals'] })
    })

    source.addEventListener('run.agent_activity', (e) => {
      const data = JSON.parse(e.data) as { runId: string }
      void queryClient.invalidateQueries({ queryKey: ['runs', data.runId, 'activity'] })
    })

    source.addEventListener('approval.requested', () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['runs'] })
    })

    return () => {
      closed = true
      source.close()
    }
  }, [filters?.runId, filters?.taskId, filters?.specId, filters?.projectId, queryClient])

  return { status }
}
