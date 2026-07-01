import { useRef, useState } from 'react'

import { api, type Project } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useQueryClient } from '@tanstack/react-query'

interface ParsedSpec {
  project: string
  spec: { name: string; status?: string; document?: string }
  tasks: Array<{
    name: string
    prompt: string
    repos?: string[]
    verification?: string[]
    depends_on?: string[]
    requiredRole?: string
  }>
}

export function ImportSpecDialog({ projectId, projects }: { projectId?: string; projects?: Project[] }) {
  const [open, setOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '')
  const [importText, setImportText] = useState('')
  const [parsed, setParsed] = useState<ParsedSpec | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  // Resolve the effective project ID: explicit prop > selected in dialog > first project
  const effectiveProjectId = projectId ?? (selectedProjectId || (projects?.[0]?.id ?? ''))
  const multiProject = !projectId && (projects?.length ?? 0) > 1

  function reset() {
    setImportText(''); setParsed(null); setError(''); setResult('')
    if (!projectId) setSelectedProjectId('')
  }

  function handleParse(text: string) {
    setImportText(text)
    setError('')
    setParsed(null)
    setResult('')
    if (!text.trim()) return
    try {
      const data = JSON.parse(text) as ParsedSpec
      if (!data?.spec?.name) { setError('Missing spec.name'); return }
      if (!data?.tasks?.length) { setError('No tasks found'); return }
      if (!Array.isArray(data?.tasks)) { setError('tasks must be an array'); return }
      const badTask = data.tasks.find((t: unknown) => typeof (t as Record<string,unknown>)?.name !== 'string' || typeof (t as Record<string,unknown>)?.prompt !== 'string')
      if (badTask) { setError('Each task must have a string name and prompt'); return }
      setParsed(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => handleParse(reader.result as string)
    reader.readAsText(file)
  }

  async function handleImport() {
    if (!parsed || !effectiveProjectId) return
    setImporting(true)
    setError('')
    try {
      const res = await api.importSpec(effectiveProjectId, parsed)
      void qc.invalidateQueries({ queryKey: ['specs'] })
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      setResult(`Imported "${parsed.spec.name}" with ${res.taskCount} tasks`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Import Spec</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
            <DialogTitle>Import Spec JSON</DialogTitle>
            <DialogDescription>
            Paste the API import shape, preview it, then import the spec and its tasks into this project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {multiProject && (
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger><SelectValue placeholder="Select a project…" /></SelectTrigger>
                <SelectContent>
                  {(projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Choose File</Button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
            <span className="text-xs text-muted-foreground self-center">or paste below</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="spec-import-json">Spec import JSON</Label>
            <Textarea
              id="spec-import-json"
              value={importText}
              onChange={(e) => handleParse(e.target.value)}
              placeholder='{"spec":{"name":"my-spec"},"tasks":[{"name":"P1","prompt":"..."}]}'
              rows={8}
              className="font-mono text-xs"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && <p className="text-sm text-teal-600">{result}</p>}

          {parsed && !result && (
            <div className="rounded border p-3 space-y-2">
              <p className="text-sm font-medium">Preview</p>
              <p className="text-sm">Spec: <span className="font-semibold">{parsed.spec.name}</span></p>
              <p className="text-sm">{parsed.tasks.length} tasks:</p>
              <ul className="space-y-1">
                {parsed.tasks.map((t, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{t.name}</span>
                    {t.depends_on && t.depends_on.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">deps: {t.depends_on.join(', ')}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false); reset() }}>Cancel</Button>
          <Button disabled={!parsed || importing || !!result || !effectiveProjectId} onClick={handleImport}>
            {importing ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
