import type { RunId } from '@ductum/core'

interface WorkflowInfo {
  activeStage: string
  stages: Array<{
    id: string
    tools: string[]
    exit: Array<{ condition: string; message?: string }>
  }>
}

export async function fetchRunWorkflowHint(apiUrl: string, runId: RunId): Promise<string> {
  try {
    const res = await fetch(`${apiUrl}/api/runs/${encodeURIComponent(runId)}/workflow`, {
      headers: operatorTokenHeader(),
    })
    if (!res.ok) return ''
    const info = await res.json() as WorkflowInfo
    return buildWorkflowHint(info)
  } catch {
    return ''
  }
}

export function buildWorkflowHint(info: WorkflowInfo): string {
  const currentStage = info.stages.find((stage) => stage.id === info.activeStage)
  const stageList = info.stages.map((stage) => stage.id).join(' -> ')
  const requiredReads = currentStage?.exit
    .map((entry) => entry.condition.match(/^file_read\("([^"]+)"\)$/)?.[1])
    .filter((value): value is string => value != null && value !== '') ?? []

  return [
    '',
    '',
    '## Workflow Rules (enforced)',
    `Stages: ${stageList}`,
    `Current stage: ${info.activeStage}`,
    currentStage == null ? '' : `Allowed tools now: ${currentStage.tools.join(', ')}`,
    requiredReads.length === 0
      ? ''
      : `First read these files before editing: ${requiredReads.join(', ')}`,
    'Do not retry blocked writes. Satisfy the current stage exit conditions, then continue.',
  ].filter(Boolean).join('\n')
}

function operatorTokenHeader(): Record<string, string> | undefined {
  const token = process.env.DUCTUM_OPERATOR_TOKEN?.trim()
  return token == null || token === '' || isPlaceholderToken(token)
    ? undefined
    : { 'x-ductum-operator-token': token }
}

function isPlaceholderToken(token: string): boolean {
  return ['missing', 'changeme', 'replace-me'].includes(token.toLowerCase())
}
