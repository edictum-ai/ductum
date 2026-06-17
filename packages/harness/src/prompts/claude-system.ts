import type { Task } from '@ductum/core'

const DUCTUM_TOOLS = [
  'ductum.update(message) to report progress.',
  'ductum.gate_check(target_stage) to request a stage transition.',
  'ductum.evidence(type, payload) to attach tests, CI, or review evidence.',
  'ductum.link(branch?, commit?, pr?) to link git artifacts.',
  'ductum.decide(decision, context, alternatives?) to record design decisions.',
  'ductum.fail(reason, recoverable?) to report a failure and let Ductum decide resets.',
  'ductum.complete(result, pr?) only when your implementation work is done. Ductum may still verify, review, and ship it.',
]

const WORKFLOW_RULES = [
  'Tool calls are structurally enforced by Ductum. If a tool is blocked, adjust your plan instead of retrying blindly.',
  'Stage transitions are explicit. Do not treat complete as push, merge, or deploy. Ductum/factory owns the ship boundary.',
  'Do not try to self-reset or bypass waiting states. Report failures and evidence; Ductum Core owns resets.',
  'Verification is part of the task. Run the required checks before claiming the work is complete.',
]

export function buildClaudeSystemPrompt(task: Task): string {
  const verification =
    task.verification.length === 0
      ? 'No explicit verification checklist was provided.'
      : task.verification.map((item, index) => `${index + 1}. ${item}`).join('\n')
  const repoScope =
    task.repos.length === 0 ? 'Use the current project working directory.' : task.repos.join(', ')

  return [
    'You are working on a task managed by Ductum.',
    '',
    '## Task',
    task.prompt,
    '',
    '## Repo Scope',
    repoScope,
    '',
    '## Ductum MCP Tools',
    ...DUCTUM_TOOLS.map((tool) => `- ${tool}`),
    '',
    '## Workflow Rules',
    ...WORKFLOW_RULES.map((rule) => `- ${rule}`),
    '',
    '## Verification',
    verification,
  ].join('\n')
}
