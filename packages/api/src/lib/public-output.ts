import {
  redactPublicOutput,
  redactPublicSpawnConfig,
  redactPublicText,
  type Agent,
  type ConfigResource,
  type Evidence,
  type GateEvaluation,
  type Run,
  type RunActivity,
  type RunStageTransition,
  type RunUpdate,
} from '@ductum/core'

export function publicAgent(agent: Agent): Agent {
  return { ...agent, spawnConfig: redactPublicSpawnConfig(agent.spawnConfig) }
}

export function publicOutput<T>(value: T): T {
  return redactPublicOutput(value)
}

export function publicConfigResource(resource: ConfigResource): ConfigResource {
  return { ...resource, spec: redactPublicOutput(resource.spec) }
}

export function publicRun<T extends Run>(run: T): T {
  return redactPublicOutput(run)
}

export function publicRuns<T extends Run>(runs: T[]): T[] {
  return runs.map(publicRun)
}

export function publicNullableRun<T extends Run>(run: T | null): T | null {
  return run == null ? null : publicRun(run)
}

export function publicAttempt<T>(attempt: T): T {
  return redactPublicOutput(attempt)
}

export function publicEvidence(evidence: Evidence): Evidence {
  return { ...evidence, payload: redactPublicOutput(evidence.payload) }
}

export function publicGateEvaluation(evaluation: GateEvaluation): GateEvaluation {
  return {
    ...evaluation,
    target: redactPublicText(evaluation.target),
    reason: evaluation.reason == null ? null : redactPublicText(evaluation.reason),
  }
}

export function publicRunUpdate(update: RunUpdate): RunUpdate {
  return { ...update, message: redactPublicText(update.message) }
}

export function publicRunActivity(activity: RunActivity): RunActivity {
  return {
    ...activity,
    content: redactPublicText(activity.content),
    toolName: activity.toolName == null ? activity.toolName : redactPublicText(activity.toolName),
  }
}

export function publicRunHistory(transition: RunStageTransition): RunStageTransition {
  return {
    ...transition,
    reason: transition.reason == null ? null : redactPublicText(transition.reason),
  }
}
