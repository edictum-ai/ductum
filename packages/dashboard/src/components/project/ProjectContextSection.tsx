import type { Project, Repository } from '@/api/client'
import { Card, Mono, SectionHeading, tokens } from '@/components/signal'
import { projectAudience, projectPurpose } from '@/lib/spec-brief'

export function ProjectContextSection({
  project,
  repositories,
}: {
  project: Project
  repositories: Repository[]
}) {
  return (
    <section>
      <SectionHeading title="Project context" meta="who and why" />
      <div className="grid gap-3 md:grid-cols-2">
        <ContextCard title="Purpose" body={projectPurpose(project, repositories)} />
        <ContextCard title="For" body={projectAudience(project, repositories)} />
      </div>
    </section>
  )
}

function ContextCard({ title, body }: { title: string; body: string }) {
  return (
    <Card pad={14}>
      <div style={{ display: 'grid', gap: 8 }}>
        <Mono size={11} color={tokens.dim}>{title}</Mono>
        <div className="text-sm leading-6 text-foreground/90">{body}</div>
      </div>
    </Card>
  )
}
