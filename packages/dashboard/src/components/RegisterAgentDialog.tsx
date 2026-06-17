import { useState } from 'react'

import { useModelCatalog, useRegisterAgent } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function RegisterAgentDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [harness, setHarness] = useState('claude-agent-sdk')
  const [capInput, setCapInput] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const registerAgent = useRegisterAgent()
  const { data: catalog } = useModelCatalog()
  const modelOptions = (catalog?.models ?? []).filter((m) => m.supportedHarnesses.includes(harness))
  const harnessOptions = catalog?.harnesses ?? [
    { id: 'claude-agent-sdk', label: 'Claude Agent SDK' },
    { id: 'codex-sdk', label: 'Codex SDK' },
  ]

  function reset() {
    setName(''); setModel(''); setHarness('claude-agent-sdk'); setCapInput(''); setCapabilities([])
  }

  function addCap() {
    const trimmed = capInput.trim()
    if (trimmed && !capabilities.includes(trimmed)) {
      setCapabilities([...capabilities, trimmed])
      setCapInput('')
    }
  }

  function handleSubmit() {
    if (!name.trim() || !model.trim()) return
    registerAgent.mutate(
      { name: name.trim(), modelRef: model.trim(), harnessRef: harness, capabilities: capabilities.length > 0 ? capabilities : undefined },
      { onSuccess: () => { reset(); setOpen(false) } },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">+ Add Agent</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Agent</DialogTitle>
          <DialogDescription>
            Add an agent, pick its harness, and set the capabilities Ductum should route against.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mimi" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-harness">Harness</Label>
            <Select value={harness} onValueChange={(value) => { setHarness(value); setModel('') }}>
              <SelectTrigger id="agent-harness"><SelectValue /></SelectTrigger>
              <SelectContent>
                {harnessOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-model">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="agent-model"><SelectValue placeholder="Pick a validated model" /></SelectTrigger>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {model !== '' && (
              <div className="text-xs text-muted-foreground">
                {modelOptions.find((option) => option.id === model)?.note}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Capabilities</Label>
            <div className="flex gap-2">
              <Input value={capInput} onChange={(e) => setCapInput(e.target.value)} placeholder="e.g. build" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCap() } }} />
              <Button type="button" variant="outline" size="sm" onClick={addCap}>Add</Button>
            </div>
            {capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {capabilities.map((cap, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                    {cap}
                    <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setCapabilities(capabilities.filter((_, j) => j !== i))}>&times;</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {registerAgent.error instanceof Error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {registerAgent.error.message}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!name.trim() || !model.trim() || registerAgent.isPending} onClick={handleSubmit}>Register</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
