import { ExternalLink } from 'lucide-react'

import type { Repository, Spec, Task } from '@/api/client'
import { buildSpecBrief } from '@/lib/spec-brief'

export function SpecBriefPanel({
  spec,
  tasks,
  projectName,
  repositories,
  compact = false,
}: {
  spec: Spec
  tasks?: Task[]
  projectName?: string
  repositories?: Repository[]
  compact?: boolean
}) {
  const brief = buildSpecBrief({ spec, tasks, projectName, repositories })
  const details = compact ? brief.highlights.slice(0, 2) : brief.highlights
  const verification = compact ? [] : brief.verification
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-sm leading-6 text-foreground/90">{brief.summary}</div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground/65">
          <span>For {brief.audience}</span>
          {brief.sourceLabel && (
            <a
              href={brief.sourceUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary/80 hover:text-primary"
            >
              {brief.sourceLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      {(details.length > 0 || verification.length > 0) && (
        <div className="space-y-1.5 border-l border-border/35 pl-3 text-[12px] leading-5 text-muted-foreground">
          {details.map((item) => (
            <div key={item}>{item}</div>
          ))}
          {verification.map((item) => (
            <div key={item} className="text-emerald-200/85">Verify: {item}</div>
          ))}
        </div>
      )}
    </div>
  )
}
