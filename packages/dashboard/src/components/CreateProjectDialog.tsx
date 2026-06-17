import { useState } from 'react'
import type { ReactNode } from 'react'

import { useCreateProject } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CreateProjectDialog({ onCreated }: { onCreated?: (projectName: string) => void }) {
  const createProject = useCreateProject()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [repoName, setRepoName] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [mergeMode, setMergeMode] = useState('human')

  function reset() {
    setName('')
    setRepoName('')
    setLocalPath('')
    setMergeMode('human')
  }

  function submit() {
    const projectName = name.trim()
    if (projectName === '') return
    const repoPath = localPath.trim()
    const repository = repoPath === ''
      ? undefined
      : {
          name: repoName.trim() || projectName,
          spec: { localPath: repoPath },
        }
    createProject.mutate(
      { name: projectName, repository, config: { mergeMode } },
      {
        onSuccess: (project) => {
          reset()
          setOpen(false)
          onCreated?.(project.name)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm">+ New Project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a project and optionally attach its first local repository.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Project name" id="project-name">
            <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="personal-memory" />
          </Field>
          <Field label="Merge mode" id="project-merge-mode">
            <select
              id="project-merge-mode"
              value={mergeMode}
              onChange={(event) => setMergeMode(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="human">human</option>
              <option value="auto">auto</option>
            </select>
          </Field>
          <Field label="Repository name" id="project-repo-name">
            <Input id="project-repo-name" value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="optional; defaults to project name" />
          </Field>
          <Field label="Repository local path" id="project-repo-path">
            <Input id="project-repo-path" value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="/absolute/path/to/repo" />
          </Field>
          {createProject.error instanceof Error && <p className="text-sm text-destructive">{createProject.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={name.trim() === '' || createProject.isPending} onClick={submit}>
            {createProject.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>
}
