import { useState } from 'react'

import type { Task } from '@/api/client'
import { useAddTaskDependency, useCreateTask, useEvaluateDag } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const ANY_ROLE = 'any'

function ListInput({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState('')
  function add() {
    const trimmed = input.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
      setInput('')
    }
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <Button type="button" variant="outline" size="sm" onClick={add}>Add</Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
              {item}
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((_, j) => j !== i))}>&times;</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function CreateTaskDialog({ specId, existingTasks }: { specId: string; existingTasks: Task[] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [repos, setRepos] = useState<string[]>([])
  const [verification, setVerification] = useState<string[]>([])
  const [requiredRole, setRequiredRole] = useState(ANY_ROLE)
  const [depIds, setDepIds] = useState<string[]>([])
  const [depSearch, setDepSearch] = useState('')
  const createTask = useCreateTask()
  const addDep = useAddTaskDependency()
  const evaluateDag = useEvaluateDag()

  function reset() {
    setName(''); setPrompt(''); setRepos([]); setVerification([]); setRequiredRole(ANY_ROLE); setDepIds([]); setDepSearch('')
  }

  async function handleSubmit() {
    if (!name.trim() || !prompt.trim()) return
    createTask.mutate(
      {
        specId,
        name: name.trim(),
        prompt: prompt.trim(),
        repos: repos.length > 0 ? repos : undefined,
        verification: verification.length > 0 ? verification : undefined,
        requiredRole: requiredRole !== ANY_ROLE ? requiredRole : undefined,
      },
      {
        onSuccess: async (task) => {
          for (const depId of depIds) {
            addDep.mutate({ taskId: task.id, dependsOnId: depId })
          }
          evaluateDag.mutate(specId)
          reset()
          setOpen(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">+ New Task</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>
            Add a task, set its prompt, and wire any dependencies before Ductum re-evaluates the DAG.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">Name</Label>
            <Input id="task-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. implement-auth-middleware" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-prompt">Prompt</Label>
            <Textarea id="task-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Task implementation prompt..." rows={6} />
          </div>
          <ListInput label="Repos" value={repos} onChange={setRepos} placeholder="e.g. edictum-ai/ductum" />
          <ListInput label="Verification checklist" value={verification} onChange={setVerification} placeholder="e.g. pnpm test passes" />
          <div className="space-y-2">
            <Label htmlFor="task-role">Required Role</Label>
            <Select value={requiredRole} onValueChange={setRequiredRole}>
              <SelectTrigger id="task-role"><SelectValue placeholder="Any" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_ROLE}>Any role</SelectItem>
                <SelectItem value="builder">Builder</SelectItem>
                <SelectItem value="reviewer">Reviewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {existingTasks.length > 0 && (
            <div className="space-y-2">
              <Label>Dependencies</Label>
              <Input
                placeholder="Search tasks…"
                value={depSearch}
                onChange={(e) => setDepSearch(e.target.value)}
              />
              <div className="space-y-3 max-h-52 overflow-y-auto pr-1">
                {(() => {
                  const filtered = existingTasks.filter(t =>
                    t.name.toLowerCase().includes(depSearch.toLowerCase())
                  )
                  if (filtered.length === 0) return (
                    <p className="text-xs text-muted-foreground">No tasks match.</p>
                  )
                  const byStatus = new Map<string, Task[]>()
                  for (const t of filtered) {
                    const g = byStatus.get(t.status) ?? []
                    g.push(t)
                    byStatus.set(t.status, g)
                  }
                  return [...byStatus.entries()].map(([status, tasks]) => (
                    <div key={status}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{status}</p>
                      {tasks.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-sm py-0.5">
                          <input
                            type="checkbox"
                            checked={depIds.includes(t.id)}
                            onChange={(e) => {
                              if (e.target.checked) setDepIds([...depIds, t.id])
                              else setDepIds(depIds.filter((d) => d !== t.id))
                            }}
                            className="rounded"
                          />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  ))
                })()}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !prompt.trim() || createTask.isPending} onClick={handleSubmit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
