import { useNavigate } from 'react-router-dom'

import type { Agent, ProjectAgent, Run, Spec, Task } from '@/api/client'
import { SectionHeading } from '@/components/signal'
import { TaskDispatchPanel } from '@/components/task/TaskDispatchPanel'
import { shortId } from '@/lib/display'
import { displaySpecName, displayTaskName, specRouteSegment, taskRouteSegment } from '@/lib/project-display'

function enc(value: string): string {
  return encodeURIComponent(value)
}

export function ReadyTaskQueue({
  projectName,
  tasks,
  specs,
  agents,
  projectAgents,
}: {
  projectName: string
  tasks: Task[]
  specs: Spec[]
  agents: Agent[]
  projectAgents: ProjectAgent[]
}) {
  const navigate = useNavigate()
  const ready = tasks.filter((task) => task.status === 'ready')
  const specById = new Map(specs.map((spec) => [spec.id, spec]))
  if (ready.length === 0) return null

  function openRun(task: Task, run: Run) {
    const spec = specById.get(task.specId)
    if (spec == null) return
    navigate(`/${enc(projectName)}/${enc(specRouteSegment(spec))}/${enc(taskRouteSegment(task))}/${enc(shortId(run.id))}`)
  }

  return (
    <section>
      <SectionHeading title="Ready to dispatch" meta={ready.length} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {ready.map((task) => {
          const spec = specById.get(task.specId)
          return (
            <TaskDispatchPanel
              key={task.id}
              task={task}
              agents={agents}
              projectAgents={projectAgents}
              title={displayTaskName(task)}
              meta={spec == null ? 'ready task' : `${displaySpecName(spec)} · ready`}
              onStarted={(run) => openRun(task, run)}
            />
          )
        })}
      </div>
    </section>
  )
}
