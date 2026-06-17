import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router-dom'

import { api } from '@/api/client'
import { Card, Mono, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'

/**
 * Resolves legacy `/runs/<fullRunId>` links to the canonical
 * `/<project>/<spec>/<task>/<shortRunId>` URL printed by the CLI
 * (`ductum status`, `ductum approve`, etc.). Renders a focused
 * "Attempt not found" message when the id is unknown so the operator
 * does not see the misleading "Spec X could not be resolved" error.
 */
export function RunRedirect() {
  const { runId } = useParams<{ runId: string }>()
  const id = runId ?? ''
  const { data, error, isLoading } = useQuery({
    queryKey: ['resolve', 'run', id],
    queryFn: () => api.resolveRunById(id),
    enabled: id !== '',
    retry: false,
  })

  if (id === '') return <RunNotFound id="" />
  if (isLoading) return null
  if (error != null || data == null) return <RunNotFound id={id} />

  const enc = encodeURIComponent
  const target = `/${enc(data.project.name)}/${enc(data.spec.name)}/${enc(data.task.name)}/${enc(shortId(data.run.id))}`
  return <Navigate to={target} replace />
}

function RunNotFound({ id }: { id: string }) {
  return (
    <div style={{ padding: '36px 40px', maxWidth: 720, margin: '0 auto' }}>
      <Card>
        <div style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: tokens.strong, marginBottom: 8 }}>
            Attempt not found
          </div>
          <Mono size={12} color={tokens.dim}>
            {id === '' ? 'No attempt id supplied.' : `No attempt with id ${id}.`}
          </Mono>
        </div>
      </Card>
    </div>
  )
}
