import { GitCompareArrows } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import type { Agent, BestOfNPolicy, ProjectAgent, Repository } from '@/api/client'
import { useCreateBakeoff } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const POLICIES: Array<{ id: BestOfNPolicy; label: string }> = [
  { id: 'quality-gated-cost-aware', label: 'Quality gated, cost aware' },
  { id: 'cheapest-verified-reviewed', label: 'Cheapest verified and reviewed' },
]

export function CreateBakeoffDialog({
  projectId,
  agents,
  projectAgents,
  repositories = [],
  onCreated,
}: {
  projectId: string
  agents: Agent[]
  projectAgents: ProjectAgent[]
  repositories?: Repository[]
  onCreated?: (specName: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [policy, setPolicy] = useState<BestOfNPolicy>('quality-gated-cost-aware')
  const [scopeValue, setScopeValue] = useState('project')
  const [reviewerAgentId, setReviewerAgentId] = useState('')
  const [builderAgentIds, setBuilderAgentIds] = useState<string[]>([])
  const [verifyText, setVerifyText] = useState('')
  const createBakeoff = useCreateBakeoff()

  const builderIds = useMemo(() => roleIds(projectAgents, 'builder'), [projectAgents])
  const reviewerIds = useMemo(() => roleIds(projectAgents, 'reviewer'), [projectAgents])
  const builders = agents.filter((agent) => builderIds.has(agent.id))
  const reviewers = agents.filter((agent) => reviewerIds.has(agent.id))
  const selectedBuilders = builders.filter((agent) => builderAgentIds.includes(agent.id))
  const selectedReviewer = reviewers.find((agent) => agent.id === reviewerAgentId)
  const modelConflict = selectedReviewer != null && selectedBuilders.some((agent) => agent.model === selectedReviewer.model)
  const builderConflict = hasDuplicateBuilderConfig(selectedBuilders)
  const verify = verifyText.split('\n').map((line) => line.trim()).filter(Boolean)
  const error = validationError(name, prompt, builderAgentIds, modelConflict, builderConflict)
  const scope = selectedScope(scopeValue)

  function reset() {
    setName('')
    setPrompt('')
    setPolicy('quality-gated-cost-aware')
    setScopeValue('project')
    setReviewerAgentId('')
    setBuilderAgentIds([])
    setVerifyText('')
  }

  function toggleBuilder(agentId: string) {
    setBuilderAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : current.length >= 5 ? current : [...current, agentId],
    )
  }

  function submit() {
    if (error != null) return
    createBakeoff.mutate(
      {
        projectId,
        name: name.trim(),
        prompt: prompt.trim(),
        builderAgentIds,
        ...(scope.repositoryId == null ? {} : { repositoryId: scope.repositoryId }),
        ...(scope.componentId == null ? {} : { componentId: scope.componentId }),
        ...(reviewerAgentId === '' ? {} : { reviewerAgentId }),
        policy,
        verify,
      },
      { onSuccess: (result) => { reset(); setOpen(false); onCreated?.(result.spec.name) } },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><GitCompareArrows className="h-3.5 w-3.5" /> Best-of-N</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Best-of-N</DialogTitle>
          <DialogDescription>Run one prompt through multiple project builders and compare the result before approval.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <Field label="Name" id="bakeoff-name"><Input id="bakeoff-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Policy / rubric" id="bakeoff-policy">
            <select id="bakeoff-policy" className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" value={policy} onChange={(e) => setPolicy(e.target.value as BestOfNPolicy)}>
              {POLICIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Scope" id="bakeoff-scope">
            <select id="bakeoff-scope" className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}>
              <option value="project">Project</option>
              {repositories.map((repo) => <option key={repo.id} value={`repo:${repo.id}`}>Repository · {repo.name}</option>)}
              {repositories.flatMap((repo) => (repo.components ?? []).map((component) => (
                <option key={component.id} value={`component:${repo.id}:${component.id}`}>Component · {repo.name}/{component.name}</option>
              )))}
            </select>
          </Field>
          <Field label="Prompt" id="bakeoff-prompt" wide><Textarea id="bakeoff-prompt" rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
          <Picker title="Builders" empty="No project builders assigned">
            {builders.map((agent) => (
              <AgentChoice key={agent.id} agent={agent} checked={builderAgentIds.includes(agent.id)} onChange={() => toggleBuilder(agent.id)} />
            ))}
          </Picker>
          <Field label="Reviewer" id="bakeoff-reviewer">
            <select id="bakeoff-reviewer" className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm" value={reviewerAgentId} onChange={(e) => setReviewerAgentId(e.target.value)}>
              <option value="">Auto reviewer</option>
              {reviewers.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.model}</option>)}
            </select>
          </Field>
          <Field label="Verify commands" id="bakeoff-verify">
            <Textarea id="bakeoff-verify" rows={4} value={verifyText} onChange={(e) => setVerifyText(e.target.value)} placeholder="one command per line" />
          </Field>
        </div>
        {error != null && <p className="text-sm text-destructive">{error}</p>}
        {createBakeoff.error != null && <p className="text-sm text-destructive">{createBakeoff.error.message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={error != null || createBakeoff.isPending}>Start bakeoff</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function roleIds(assignments: ProjectAgent[], role: string) {
  return new Set(assignments.filter((item) => item.role === role).map((item) => item.agentId))
}

function selectedScope(value: string): { repositoryId?: string; componentId?: string } {
  const parts = value.split(':')
  if (parts[0] === 'repo' && parts[1]) return { repositoryId: parts[1] }
  if (parts[0] === 'component' && parts[1] && parts[2]) return { repositoryId: parts[1], componentId: parts[2] }
  return {}
}

function validationError(name: string, prompt: string, builders: string[], modelConflict: boolean, builderConflict: boolean) {
  if (builders.length < 2) return 'Needs at least two project builders assigned.'
  if (name.trim() === '') return 'Name is required.'
  if (prompt.trim() === '') return 'Prompt is required.'
  if (builderConflict) return 'Builder model, harness, and effort combinations must be unique.'
  if (modelConflict) return 'Reviewer model must differ from every builder model.'
  return null
}

function hasDuplicateBuilderConfig(builders: Agent[]) {
  const seen = new Set<string>()
  for (const builder of builders) {
    const key = `${builder.model.trim().toLowerCase()}:${builder.harness}:${builder.effort ?? ''}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

function Field({ label, id, children, wide }: { label: string; id: string; children: ReactNode; wide?: boolean }) {
  return <div className={`space-y-2 ${wide ? 'md:col-span-2' : ''}`}><Label htmlFor={id}>{label}</Label>{children}</div>
}

function Picker({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return <div className="space-y-2"><Label>{title}</Label><div className="grid gap-2">{children || <p className="text-sm text-muted-foreground">{empty}</p>}</div></div>
}

function AgentChoice({ agent, checked, onChange }: { agent: Agent; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="min-w-0 flex-1"><span className="block font-medium">{agent.name}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{agent.model} · {agent.harness}</span></span>
      <span className="font-mono text-[11px] text-muted-foreground">tier {agent.costTier}</span>
    </label>
  )
}
