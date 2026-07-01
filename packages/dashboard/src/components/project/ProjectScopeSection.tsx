import type { ReactNode } from 'react'

import type { Repository } from '@/api/client'
import { Card, Mono, SectionHeading, tokens } from '@/components/signal'

export function ProjectScopeSection({
  repositories,
  fallbackRepos,
  specCount,
  taskCount,
  attemptCount,
  action,
}: {
  repositories: Repository[]
  fallbackRepos: string[]
  specCount: number
  taskCount: number
  attemptCount: number
  action?: ReactNode
}) {
  const repositoryNames = repositories.length > 0
    ? repositories.map((repo) => repo.name)
    : fallbackRepos.map((repo) => repo.split('/').pop() ?? repo)
  const componentNames = repositories.flatMap((repo) =>
    (repo.components ?? []).map((component) => `${repo.name}/${component.name}`),
  )

  return (
    <section>
      <SectionHeading title="Under this project" meta="scope" action={action} level={2} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <ScopeCard title="Repositories" value={repositoryNames.length} lines={repositoryNames} empty="No repositories configured" />
        <ScopeCard title="Components" value={componentNames.length} lines={componentNames} empty="Optional repository scopes" />
        <ScopeCard title="Specs" value={specCount} />
        <ScopeCard title="Tasks" value={taskCount} />
        <ScopeCard title="Attempts" value={attemptCount} />
      </div>
    </section>
  )
}

function ScopeCard({
  title,
  value,
  lines,
  empty,
}: {
  title: string
  value: number
  lines?: string[]
  empty?: string
}) {
  return (
    <Card pad={14}>
      <div style={{ display: 'grid', gap: 8 }}>
        <Mono size={11} color={tokens.dim}>{title}</Mono>
        <div style={{ fontSize: 28, lineHeight: 1, color: tokens.strong, fontWeight: 500 }}>{value}</div>
        {lines != null && (
          <div style={{ display: 'grid', gap: 3 }}>
            {lines.length === 0 ? (
              <Mono size={11} color={tokens.faint}>{empty}</Mono>
            ) : lines.slice(0, 3).map((line) => (
              <Mono key={line} size={11} color={tokens.mid} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {line}
              </Mono>
            ))}
            {lines.length > 3 && <Mono size={11} color={tokens.faint}>+{lines.length - 3} more</Mono>}
          </div>
        )}
      </div>
    </Card>
  )
}
