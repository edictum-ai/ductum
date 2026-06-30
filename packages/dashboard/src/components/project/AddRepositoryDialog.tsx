import { useState } from 'react'
import type { ReactNode } from 'react'

import { useCreateRepository } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AddRepositoryDialog({ projectId }: { projectId: string }) {
  const createRepository = useCreateRepository()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')

  function reset() {
    setName('')
    setLocalPath('')
    setRemoteUrl('')
    setDefaultBranch('main')
  }

  function submit() {
    const repoName = name.trim()
    const local = localPath.trim()
    const remote = remoteUrl.trim()
    if (repoName === '' || (local === '' && remote === '')) return
    createRepository.mutate(
      {
        projectId,
        repository: {
          name: repoName,
          spec: {
            ...(local === '' ? {} : { localPath: local }),
            ...(remote === '' ? {} : { remoteUrl: remote }),
            ...(defaultBranch.trim() === '' ? {} : { defaultBranch: defaultBranch.trim() }),
          },
        },
      },
      { onSuccess: () => { reset(); setOpen(false) } },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">+ Repository</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Repository</DialogTitle>
          <DialogDescription>Add a repository or local working tree under this project.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name required" id="repository-name">
            <Input id="repository-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Local path" id="repository-local-path" hint="Use an absolute path, or provide a remote URL instead.">
            <Input id="repository-local-path" value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="/absolute/path/to/repo" />
          </Field>
          <Field label="Remote URL" id="repository-remote-url" hint="Add either local path or remote URL.">
            <Input id="repository-remote-url" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="optional git remote" />
          </Field>
          <Field label="Default branch" id="repository-default-branch">
            <Input id="repository-default-branch" value={defaultBranch} onChange={(event) => setDefaultBranch(event.target.value)} />
          </Field>
          {createRepository.error instanceof Error && <p className="text-sm text-destructive">{createRepository.error.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={name.trim() === '' || (localPath.trim() === '' && remoteUrl.trim() === '') || createRepository.isPending} onClick={submit}>
            {createRepository.isPending ? 'Adding…' : 'Add repository'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
}
