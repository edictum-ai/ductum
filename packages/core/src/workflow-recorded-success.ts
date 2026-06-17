import type { Session, WorkflowDefinition, WorkflowRuntime, WorkflowState } from '@edictum/core'

type WorkflowStage = WorkflowDefinition['stages'][number]

const WORKFLOW_APPROVED_STATUS = 'approved'

export async function advanceWorkflowAfterRecordedSuccess(
  runtime: WorkflowRuntime,
  session: Session,
  envelope: Parameters<WorkflowRuntime['recordResult']>[2],
): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = []

  for (;;) {
    const state = await runtime.state(session)
    const stage = getActiveStage(runtime.definition, state.activeStage)
    if (stage == null) {
      return events
    }

    const nextStage = getNextStage(runtime.definition, stage.id)
    if (nextStage == null || !(await canAdvanceToNextStage(runtime, stage, nextStage, state, envelope))) {
      return events
    }

    await runtime.setStage(session, nextStage.id)
    events.push({
      action: 'workflow_stage_advanced',
      workflow: {
        workflow_name: runtime.definition.metadata.name,
        stage_id: stage.id,
        to_stage_id: nextStage.id,
      },
    })
  }
}

async function canAdvanceToNextStage(
  runtime: WorkflowRuntime,
  stage: WorkflowStage,
  nextStage: WorkflowStage,
  state: WorkflowState,
  envelope: Parameters<WorkflowRuntime['recordResult']>[2],
): Promise<boolean> {
  if (!isForwardStage(runtime.definition, state.activeStage, nextStage.id)) {
    return false
  }

  if (stage.exit.length === 0 && stage.approval == null) {
    return false
  }

  if (stage.exit.length > 0) {
    const exitResult = await runtime.evaluateWorkflowGates(stage, state, envelope, stage.exit)
    if (exitResult.blocked) {
      return false
    }
  }

  if (stage.approval != null && state.approvals[stage.id] !== WORKFLOW_APPROVED_STATUS) {
    return false
  }

  const nextState = {
    ...state,
    completedStages: state.completedStages.includes(stage.id)
      ? [...state.completedStages]
      : [...state.completedStages, stage.id],
  }
  const entryResult = await runtime.evaluateWorkflowGates(nextStage, nextState, envelope, nextStage.entry)
  return !entryResult.blocked
}

function getActiveStage(definition: WorkflowDefinition, stageId: string): WorkflowStage | null {
  return definition.stages.find((stage) => stage.id === stageId) ?? null
}

function getNextStage(definition: WorkflowDefinition, stageId: string): WorkflowStage | null {
  const index = definition.stages.findIndex((stage) => stage.id === stageId)
  if (index === -1) {
    return null
  }
  return definition.stages[index + 1] ?? null
}

function isForwardStage(definition: WorkflowDefinition, activeStage: string, targetStage: string): boolean {
  if (activeStage === '' || activeStage === targetStage) return false
  const currentIdx = definition.stages.findIndex((s) => s.id === activeStage)
  const targetIdx = definition.stages.findIndex((s) => s.id === targetStage)
  return targetIdx > currentIdx
}
