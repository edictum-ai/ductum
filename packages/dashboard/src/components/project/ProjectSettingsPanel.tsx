import { useEffect, useState } from 'react'

import type { Project } from '@/api/client'
import { useUpdateProject } from '@/api/hooks'
import { Btn, Card, CardHeader, Mono, tokens } from '@/components/signal'

export function ProjectSettingsPanel({
  project,
  onRenamed,
}: {
  project: Project
  onRenamed?: (name: string) => void
}) {
  const updateProject = useUpdateProject()
  const [name, setName] = useState(project.name)
  const [mergeMode, setMergeMode] = useState(project.config.mergeMode)

  useEffect(() => {
    setName(project.name)
    setMergeMode(project.config.mergeMode)
  }, [project.name, project.config.mergeMode])

  const dirty = name.trim() !== project.name || mergeMode !== project.config.mergeMode

  function save() {
    if (!dirty || name.trim() === '') return
    updateProject.mutate(
      { id: project.id, name: name.trim(), config: { ...project.config, mergeMode } },
      { onSuccess: (updated) => { if (updated.name !== project.name) onRenamed?.(updated.name) } },
    )
  }

  return (
    <Card>
      <CardHeader title="Project settings" meta="editable" />
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <Mono size={11} color={tokens.dim}>name</Mono>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={inputStyle}
            data-testid="project-name-input"
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <Mono size={11} color={tokens.dim}>merge mode</Mono>
          <select
            value={mergeMode}
            onChange={(event) => setMergeMode(event.target.value)}
            style={inputStyle}
            data-testid="project-merge-mode"
          >
            <option value="human">human</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {updateProject.error instanceof Error && <Mono size={11} color={tokens.err}>{updateProject.error.message}</Mono>}
          <Btn primary disabled={!dirty || name.trim() === '' || updateProject.isPending} onClick={save}>
            {updateProject.isPending ? 'Saving…' : 'Save project'}
          </Btn>
        </div>
      </div>
    </Card>
  )
}

const inputStyle = {
  minHeight: 34,
  borderRadius: 7,
  border: `1px solid ${tokens.rule}`,
  background: tokens.sunken,
  color: tokens.fg,
  padding: '0 10px',
  fontFamily: tokens.mono,
  fontSize: 12,
}
