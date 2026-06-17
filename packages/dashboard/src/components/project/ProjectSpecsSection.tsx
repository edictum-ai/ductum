import { useNavigate } from 'react-router-dom'

import type { Agent, EnrichedRun, ProjectRun, Spec, Task } from '@/api/client'
import { SpecSection } from '@/components/project/ProjectSpecSection'
import { SectionHeading } from '@/components/signal'

export function ProjectSpecsSection({
  projectName,
  specs,
  tasks,
  runs,
  agents,
}: {
  projectName: string
  specs: Spec[]
  tasks: Task[]
  runs: EnrichedRun[]
  agents: Agent[]
}) {
  const navigate = useNavigate()
  if (specs.length === 0) return null

  return (
    <section>
      <SectionHeading title="Specs" meta={specs.length} />
      <div className="space-y-3">
        {specs.map((spec) => (
          <SpecSection
            key={spec.id}
            spec={spec}
            tasks={tasks.filter((task) => task.specId === spec.id)}
            specRuns={runs.filter((run) => run.specName === spec.name) as unknown as ProjectRun[]}
            agents={agents}
            navigate={navigate}
            projectName={projectName}
          />
        ))}
      </div>
    </section>
  )
}
