import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { api, type Project } from '@/api/client'
import { useAgents, useFactory, useProjects, useSpecs } from '@/api/hooks'
import { ImportSpecDialog } from '@/components/ImportSpecDialog'
import { Btn, Caps, Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'

type HandoffState = 'idle' | 'exchanging' | 'ready' | 'failed'

export function Welcome() {
  const [searchParams] = useSearchParams()
  const handoffToken = searchParams.get('token')
  const exchangedRef = useRef(false)
  const [handoffState, setHandoffState] = useState<HandoffState>(handoffToken ? 'exchanging' : 'idle')
  const [handoffMessage, setHandoffMessage] = useState('')
  const queryClient = useQueryClient()

  const { data: factory } = useFactory()
  const { data: projects } = useProjects()
  const { data: agents } = useAgents()
  const firstProject = projects?.[0]
  const { data: specs } = useSpecs(firstProject?.id ?? '')
  const sampleMutation = useSampleSpecMutation(firstProject)

  useEffect(() => {
    if (!handoffToken || exchangedRef.current) return
    exchangedRef.current = true
    stripHandoffQuery()
    setHandoffState('exchanging')
    api.exchangeWelcomeHandoff(handoffToken)
      .then(() => {
        setHandoffState('ready')
        setHandoffMessage('Browser session connected.')
        for (const key of [['factory'], ['projects'], ['agents'], ['specs']]) {
          void queryClient.invalidateQueries({ queryKey: key })
        }
      })
      .catch(() => {
        setHandoffState('failed')
        setHandoffMessage('Welcome link expired. Run ductum init again to mint a fresh handoff.')
      })
  }, [handoffToken, queryClient])

  const readyAgents = useMemo(() => agents ?? [], [agents])
  const specCount = specs?.length ?? 0

  return (
    <div className="fade-in" style={{ padding: '32px 40px 48px', maxWidth: 1180, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
          marginBottom: 26,
        }}
      >
        <div>
          <Caps>{factory?.name ?? 'Ductum'} · welcome</Caps>
          <h1 style={{ margin: '10px 0 0', fontSize: 28, lineHeight: 1.15, fontWeight: 500 }}>
            Factory is running.
          </h1>
          <div style={{ marginTop: 8, color: tokens.mid, fontSize: 14 }}>
            Start with a Spec, then let Ductum run ready Tasks as Attempts.
          </div>
        </div>
        <HandoffBadge state={handoffState} message={handoffMessage} />
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: 22,
          alignItems: 'start',
        }}
      >
        <Card pad={22}>
          <CardHeader title="Next Steps" meta={firstProject?.name ?? 'Waiting for the factory project'} />
          <div style={{ display: 'grid', gap: 14 }}>
            <StepRow
              number="1"
              title="Import your first spec"
              body={firstProject ? 'Bring in a YAML spec and let Ductum create its task graph.' : 'No project is loaded yet.'}
              action={firstProject ? <ImportSpecDialog projectId={firstProject.id} projects={projects} /> : undefined}
            />
            <StepRow
              number="2"
              title="Dispatch a sample task"
              body="Create a small ready-to-run task that edits README.md and verifies the change."
              action={(
                <Btn
                  primary
                  disabled={!firstProject || sampleMutation.isPending || sampleMutation.isSuccess}
                  onClick={() => sampleMutation.mutate()}
                >
                  {sampleMutation.isPending ? 'Creating...' : sampleMutation.isSuccess ? 'Created' : 'Create Sample'}
                </Btn>
              )}
            />
            {sampleMutation.isError && (
              <div style={{ color: tokens.err, fontSize: 13 }}>
                Sample task could not be created.
              </div>
            )}
            {sampleMutation.isSuccess && (
              <div style={{ color: tokens.ok, fontSize: 13 }}>
                Sample task created. Open Specs to review or dispatch it.
              </div>
            )}
          </div>
        </Card>

        <aside style={{ display: 'grid', gap: 16 }}>
          <Card pad={18}>
            <CardHeader title="Factory" meta={factory?.id ? <Mono>{factory.id}</Mono> : 'Loading'} />
            <Metric label="Projects" value={String(projects?.length ?? 0)} />
            <Metric label="Agents" value={String(readyAgents.length)} />
            <Metric label="Specs" value={String(specCount)} />
          </Card>

          <Card pad={18}>
            <CardHeader title="Ready Agents" meta={readyAgents.length > 0 ? 'Configured during init' : 'None loaded'} />
            <div style={{ display: 'grid', gap: 10 }}>
              {readyAgents.slice(0, 4).map((agent) => (
                <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Dot color={tokens.ok} size={6} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: tokens.fg }}>{agent.name}</div>
                    <Mono size={11}>{agent.model}</Mono>
                  </div>
                </div>
              ))}
              {readyAgents.length === 0 && (
                <div style={{ fontSize: 13, color: tokens.mid }}>Run auth setup, then refresh this page.</div>
              )}
            </div>
          </Card>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/specs" style={{ textDecoration: 'none' }}>
              <Btn>Open Specs</Btn>
            </Link>
            {firstProject && (
              <Link to={`/${encodeURIComponent(firstProject.name)}`} style={{ textDecoration: 'none' }}>
                <Btn ghost>Open Project</Btn>
              </Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function stripHandoffQuery() {
  if (typeof window === 'undefined') return
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.hash}`)
}

function HandoffBadge({ state, message }: { state: HandoffState; message: string }) {
  const color = state === 'failed' ? tokens.err : state === 'ready' ? tokens.ok : tokens.mid
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, color, fontSize: 13 }}>
      <Dot color={color} pulse={state === 'exchanging'} />
      <span>{message || (state === 'exchanging' ? 'Connecting browser session...' : 'Local session')}</span>
    </div>
  )
}

function StepRow({
  number,
  title,
  body,
  action,
}: {
  number: string
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
        alignItems: 'center',
        border: `1px solid ${tokens.hair}`,
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div style={{ width: 34, flexShrink: 0 }}><Mono size={13}>{number}</Mono></div>
      <div style={{ minWidth: 220, flex: '1 1 220px' }}>
        <div style={{ fontSize: 15, color: tokens.fg, fontWeight: 500 }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: tokens.mid }}>{body}</div>
      </div>
      {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0' }}>
      <span style={{ color: tokens.mid, fontSize: 13 }}>{label}</span>
      <Mono>{value}</Mono>
    </div>
  )
}

function useSampleSpecMutation(project?: Project) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!project) throw new Error('Project is not loaded')
      const sample = await api.getWelcomeSampleSpec()
      return api.importSpec(project.id, sampleSpecBody(project, sample.data))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['specs'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['factory', 'operator-brief'] })
    },
  })
}

function sampleSpecBody(project: Project, sample: Awaited<ReturnType<typeof api.getWelcomeSampleSpec>>['data']) {
  return {
    project: project.name,
    spec: sample.spec,
    tasks: sample.tasks,
  }
}
