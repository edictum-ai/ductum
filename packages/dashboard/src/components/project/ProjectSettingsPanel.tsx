import { useEffect, useState } from 'react'

import type { Project } from '@/api/client'
import { useUpdateProject } from '@/api/hooks'
import { Btn, Card, CardHeader, fieldStyle, Mono, textareaStyle, tokens } from '@/components/signal'

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
  const [purpose, setPurpose] = useState(project.config.purpose ?? '')
  const [audience, setAudience] = useState(project.config.audience ?? '')
  const [renameConfirmed, setRenameConfirmed] = useState(false)

  useEffect(() => {
    setName(project.name)
    setMergeMode(project.config.mergeMode)
    setPurpose(project.config.purpose ?? '')
    setAudience(project.config.audience ?? '')
    setRenameConfirmed(false)
  }, [project.config.audience, project.config.mergeMode, project.config.purpose, project.name])

  const nameChanged = name.trim() !== project.name
  const renameReady = !nameChanged || renameConfirmed
  const dirty = nameChanged
    || mergeMode !== project.config.mergeMode
    || purpose.trim() !== (project.config.purpose ?? '')
    || audience.trim() !== (project.config.audience ?? '')

  function save() {
    if (!dirty || name.trim() === '' || !renameReady) return
    updateProject.mutate(
      {
        id: project.id,
        name: name.trim(),
        config: {
          ...project.config,
          mergeMode,
          purpose: purpose.trim(),
          audience: audience.trim(),
        },
      },
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
            name="project-name"
            value={name}
            onChange={(event) => { setName(event.target.value); setRenameConfirmed(false) }}
            style={fieldStyle}
            data-testid="project-name-input"
          />
        </label>
        {nameChanged && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={renameConfirmed}
              onChange={(event) => setRenameConfirmed(event.target.checked)}
              data-testid="project-rename-confirm"
            />
            <Mono size={11} color={tokens.warn}>Rename project URL from {project.name} to {name.trim()}</Mono>
          </label>
        )}
        <label style={{ display: 'grid', gap: 6 }}>
          <Mono size={11} color={tokens.dim}>merge mode</Mono>
          <select
            name="project-merge-mode"
            value={mergeMode}
            onChange={(event) => setMergeMode(event.target.value)}
            style={fieldStyle}
            data-testid="project-merge-mode"
          >
            <option value="human">human</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <Mono size={11} color={tokens.dim}>purpose</Mono>
          <textarea
            name="project-purpose"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="Optional explicit override; the project context above covers the inferred default."
            rows={2}
            style={textareaStyle}
            data-testid="project-purpose-input"
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <Mono size={11} color={tokens.dim}>audience</Mono>
          <textarea
            name="project-audience"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            placeholder="Optional explicit override; the project context above covers the inferred default."
            rows={2}
            style={textareaStyle}
            data-testid="project-audience-input"
          />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          {updateProject.error instanceof Error && <Mono size={11} color={tokens.err}>{updateProject.error.message}</Mono>}
          <Btn primary disabled={!dirty || name.trim() === '' || !renameReady || updateProject.isPending} onClick={save}>
            {updateProject.isPending ? 'Saving…' : 'Save project'}
          </Btn>
        </div>
      </div>
    </Card>
  )
}
