import { useState } from 'react'

import { useCreateSpec } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function CreateSpecDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [document, setDocument] = useState('')
  const [status, setStatus] = useState('draft')
  const createSpec = useCreateSpec()

  function reset() {
    setName('')
    setDocument('')
    setStatus('draft')
  }

  function handleSubmit() {
    if (!name.trim()) return
    createSpec.mutate(
      { projectId, name: name.trim(), document: document.trim() || undefined, status },
      { onSuccess: () => { reset(); setOpen(false) } },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">+ New Spec</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Spec</DialogTitle>
          <DialogDescription>
            Create a new spec in this project and optionally attach the initial document now.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="spec-name">Name</Label>
            <Input id="spec-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. impl-003-api-v2" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="spec-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="spec-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="spec-doc">Document</Label>
            <Textarea id="spec-doc" value={document} onChange={(e) => setDocument(e.target.value)} placeholder="Spec document content..." rows={6} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!name.trim() || createSpec.isPending} onClick={handleSubmit}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
