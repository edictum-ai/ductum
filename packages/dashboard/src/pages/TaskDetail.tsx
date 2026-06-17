import { CheckCircle2, Cpu, ListChecks } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAgents, useProjectAgents, useResolveTask, useRuns } from '@/api/hooks'
import { CopyButton } from '@/components/CopyButton'
import { RunLineageTree } from '@/components/run/RunLineageTree'
import { TaskDispatchPanel } from '@/components/task/TaskDispatchPanel'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TASK_STATUS_CLASSES } from '@/lib/stage-display'
import { parseTaskKind } from '@/lib/task-kind'
import { cn } from '@/lib/utils'
import { shortId } from '@/lib/display'

/** Encode a name for use in a slug-based URL segment. */
function enc(segment: string): string {
  return encodeURIComponent(segment)
}

const PROMPT_PREVIEW_LEN = 200

export function TaskDetail() {
  const { project: projectSlug, spec: specSlug, task: taskSlug } = useParams<{ project: string; spec: string; task: string }>()
  const navigate = useNavigate()
  const { data: resolved, isLoading } = useResolveTask(projectSlug ?? '', specSlug ?? '', taskSlug ?? '')
  const project = resolved?.project
  const spec = resolved?.spec
  const task = resolved?.task
  const { data: runs } = useRuns(task?.id ?? '')
  const { data: agents } = useAgents()
  const { data: projectAgents } = useProjectAgents(project?.id ?? '')
  const [promptExpanded, setPromptExpanded] = useState(false)

  const agentMap = new Map(agents?.map((a) => [a.id, a]) ?? [])

  if (isLoading) return <div className="shimmer h-40 rounded-lg border border-border/20 bg-card/30" />
  if (!task) return <p className="text-muted-foreground">Task not found</p>

  const promptLong = task.prompt.length > PROMPT_PREVIEW_LEN
  const assignedAgent = task.assignedAgentId ? agentMap.get(task.assignedAgentId) : null

  return (
    <div className="space-y-6 fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink onClick={() => navigate('/projects')}>Projects</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          {project ? (
            <BreadcrumbItem><BreadcrumbLink onClick={() => navigate(`/${enc(project.name)}`)}>{project.name}</BreadcrumbLink></BreadcrumbItem>
          ) : (
            <BreadcrumbItem><span className="text-muted-foreground">...</span></BreadcrumbItem>
          )}
          <BreadcrumbSeparator />
          {project && spec ? (
            <BreadcrumbItem><BreadcrumbLink onClick={() => navigate(`/${enc(project.name)}/${enc(spec.name)}`)}>{spec.name}</BreadcrumbLink></BreadcrumbItem>
          ) : (
            <BreadcrumbItem><span className="text-muted-foreground">...</span></BreadcrumbItem>
          )}
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{task.name}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Task info */}
      <Card className="border-border/40 bg-card/60">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="group flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-muted-foreground/60" />
              <h1 className="text-xl font-bold tracking-tight">{task.name}</h1>
              <CopyButton value={task.id} className="ml-1 opacity-0 group-hover:opacity-100" />
            </div>
            <Badge variant="outline" className={cn('border font-mono text-[10px]', TASK_STATUS_CLASSES[task.status] ?? '')}>
              {task.status}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {assignedAgent && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" />
                {assignedAgent.name}
                <span className="font-mono text-[10px] text-muted-foreground/50">{assignedAgent.model}</span>
              </span>
            )}
            {task.repos.map((repo) => (
              <span key={repo} className="font-mono text-[11px] text-muted-foreground/70">{repo.split('/').pop()}</span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dispatch */}
      {project && spec && task && (
        <TaskDispatchPanel
          task={task}
          agents={agents ?? []}
          projectAgents={projectAgents ?? []}
          onStarted={(run) => navigate(`/${enc(project.name)}/${enc(spec.name)}/${enc(task.name)}/${enc(shortId(run.id))}`)}
        />
      )}

      {/* Prompt */}
      <div>
        <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Prompt</h2>
        <pre className="whitespace-pre-wrap rounded-md border border-border/30 bg-muted/30 p-4 font-mono text-xs text-muted-foreground">
          {promptExpanded || !promptLong ? task.prompt : `${task.prompt.slice(0, PROMPT_PREVIEW_LEN)}...`}
        </pre>
        {promptLong && (
          <Button variant="link" size="sm" className="mt-1 px-0 text-primary" onClick={() => setPromptExpanded(!promptExpanded)}>
            {promptExpanded ? 'Show less' : 'Show more'}
          </Button>
        )}
      </div>

      {/* Verification */}
      {task.verification.length > 0 && (
        <div>
          <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Verification</h2>
          <ul className="space-y-1.5">
            {task.verification.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lineage tree — every run for this task PLUS every run in
          related lineage tasks (review-X, fix-X), walked by
          parentRunId. Replaces the flat per-task run list with the
          full impl→review→fix conversation tree. */}
      {project && spec && task && (
        <div>
          <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            Lineage tree {runs && <span className="text-muted-foreground/40">({runs.length} attempts in this task)</span>}
          </h2>
          <RunLineageTree
            projectName={project.name}
            specName={spec.name}
            lineageRoot={parseTaskKind(task.name).originalName}
          />
        </div>
      )}
    </div>
  )
}
