import {
  formatFactorySecretRef,
  redactPublicOutput,
  redactPublicSpawnConfig,
  redactPublicText,
  type Agent,
  type ConfigResource,
  type Evidence,
  type FactorySecretAccessEvent,
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

/**
 * P1 / issue #210: serialize a FactorySecretAccessEvent for API output without
 * ever exposing the bare secret id under a sensitive-named field (the generic
 * redactor would otherwise blank it). The secret is shipped as a `secret:<id>`
 * reference — a value the redactor treats as safe — so the dashboard can still
 * extract the id to link back to the secret detail page.
 */
export interface PublicSecretAccessEvent {
  id: string
  secretRef: string | null
  runId: FactorySecretAccessEvent['runId']
  agentId: FactorySecretAccessEvent['agentId']
  outcome: FactorySecretAccessEvent['outcome']
  errorMessage: FactorySecretAccessEvent['errorMessage']
  attemptedAt: string
}

export function publicSecretAccessEvent(event: FactorySecretAccessEvent): PublicSecretAccessEvent {
  return {
    id: event.id,
    secretRef: event.secretId == null ? null : formatFactorySecretRef(event.secretId),
    runId: event.runId,
    agentId: event.agentId,
    outcome: event.outcome,
    errorMessage: event.errorMessage == null ? null : redactPublicText(event.errorMessage),
    attemptedAt: event.attemptedAt,
  }
}
