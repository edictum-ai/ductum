import type { Hono } from 'hono'
import { createId, type Agent, type AgentHealthState } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { agentResourceRefsFromConfig } from '../lib/agent-resource-refs.js'
import { resolveAndValidateAgentRuntime } from '../lib/agent-runtime-validation.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import {
  optionalRecord,
  optionalString,
  optionalStringArray,
  readJson,
  requireString,
} from '../lib/http.js'
import {
  listModelCatalog,
  HARNESSES,
} from '../lib/model-catalog.js'
import { assertNoLiteralSecrets } from '../lib/literal-secrets.js'
import { publicAgent, publicOutput } from '../lib/public-output.js'
import { assertKnownSecretRefs } from '../lib/secret-refs.js'

export function registerAgentRoutes(app: Hono, context: ApiContext) {
  app.get('/api/agents', (c) => c.json(context.repos.agents.list().map(publicAgent)))
  app.get('/api/agents/health', (c) => c.json(publicOutput({
    agents: context.getAgentHealth?.() ?? defaultAgentHealth(context.repos.agents.list()),
  })))
  app.get('/api/models', (c) => c.json(publicOutput({ models: listModelCatalog(), harnesses: HARNESSES })))

  app.post('/api/agents', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const resourceRefs = agentResourceRefsFromConfig(body, 'agent')
    const name = requireString(body.name, 'name')
    const model = optionalString(body.model, 'model')
    if (body.model !== undefined && resourceRefs.modelRef != null) {
      throw new ValidationError('Agent model is a raw provider model ID; omit model when modelRef is set')
    }
    const harness = optionalString(body.harness, 'harness')
    if (body.harness !== undefined && resourceRefs.harnessRef != null) {
      throw new ValidationError('Agent harness is a raw Harness adapter type; omit harness when harnessRef is set')
    }
    if (model == null && resourceRefs.modelRef == null) {
      throw new ValidationError('Agent modelRef (Ductum model ID or Model resource id) or legacy provider model ID is required')
    }
    const runtime = resolveAndValidateAgentRuntime({
      name,
      model: model ?? '',
      harness: (harness ?? 'codex-sdk') as Agent['harness'],
      resourceRefs,
    }, null, context.repos.configResources, { effort: optionalString(body.effort, 'effort') })
    const costTier = typeof body.costTier === 'number' ? body.costTier : runtime.defaultCostTier
    const providerId = nullableStringField(body, 'providerId') ?? null
    const accountId = nullableStringField(body, 'accountId') ?? null
    const pricingRaw = optionalRecord(body.pricing, 'pricing')
    const pricing =
      pricingRaw != null
        && typeof pricingRaw.inputUsdPer1M === 'number'
        && typeof pricingRaw.outputUsdPer1M === 'number'
        ? { inputUsdPer1M: pricingRaw.inputUsdPer1M, outputUsdPer1M: pricingRaw.outputUsdPer1M }
        : null
    const spawnConfig = optionalRecord(body.spawnConfig, 'spawnConfig') ?? {}
    assertNoLiteralSecrets(spawnConfig, 'spawnConfig', 'Factory Settings.Agent')
    assertKnownSecretRefs(spawnConfig, 'spawnConfig', context.repos.secrets)
    const agent = context.repos.agents.create({
      id: createId<'AgentId'>(),
      name,
      model: runtime.model,
      harness: runtime.harness,
      providerId,
      accountId,
      resourceRefs,
      capabilities: (optionalStringArray(body.capabilities, 'capabilities') ?? []) as never,
      effort: runtime.effort,
      costTier,
      spawnConfig,
      pricing,
    })
    return c.json(publicAgent(agent), 201)
  })

  app.post('/api/agents/:name/health/reset', (c) => {
    const name = c.req.param('name')
    const agent = context.repos.agents.get(name as Agent['id']) ?? context.repos.agents.getByName(name)
    if (agent == null) throw new NotFoundError(`Agent not found: ${name}`)
    const reset = context.resetAgentHealth?.(name) ?? false
    return c.json(publicOutput({ ok: true, reset, agent: { id: agent.id, name: agent.name } }))
  })

  app.get('/api/agents/:id', (c) => {
    const agent = context.repos.agents.get(c.req.param('id') as never)
    if (agent == null) {
      throw new NotFoundError(`Agent not found: ${c.req.param('id')}`)
    }
    return c.json(publicAgent(agent))
  })

  app.put('/api/agents/:id', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const existing = context.repos.agents.get(c.req.param('id') as never)
    if (existing == null) {
      throw new NotFoundError(`Agent not found: ${c.req.param('id')}`)
    }
    const hasRefInput = hasAgentResourceRefInput(body)
    const nextRefs = hasRefInput ? agentResourceRefsFromConfig(body, 'agent') : existing.resourceRefs ?? {}
    if (body.model !== undefined && nextRefs.modelRef != null) {
      throw new ValidationError('Agent model is a raw provider model ID; omit model while modelRef is set')
    }
    if (body.harness !== undefined && nextRefs.harnessRef != null) {
      throw new ValidationError('Agent harness is a raw Harness adapter type; omit harness while harnessRef is set')
    }
    const requestedEffort = body.effort === undefined ? existing.effort : optionalString(body.effort, 'effort')
    const providerId = nullableStringField(body, 'providerId')
    const accountId = nullableStringField(body, 'accountId')
    const runtime = resolveAndValidateAgentRuntime({
      ...existing,
      model: body.model === undefined ? existing.model : requireString(body.model, 'model'),
      harness: (body.harness === undefined ? existing.harness : requireString(body.harness, 'harness')) as Agent['harness'],
      resourceRefs: nextRefs,
    }, null, context.repos.configResources, { effort: requestedEffort })
    const pricingRaw = body.pricing === null ? null : optionalRecord(body.pricing, 'pricing')
    let pricing: { inputUsdPer1M: number; outputUsdPer1M: number } | null | undefined
    if (body.pricing === null) pricing = null
    else if (
      pricingRaw != null
      && typeof pricingRaw.inputUsdPer1M === 'number'
      && typeof pricingRaw.outputUsdPer1M === 'number'
    ) {
      pricing = { inputUsdPer1M: pricingRaw.inputUsdPer1M, outputUsdPer1M: pricingRaw.outputUsdPer1M }
    }
    const spawnConfig = optionalRecord(body.spawnConfig, 'spawnConfig')
    if (spawnConfig !== undefined) {
      assertNoLiteralSecrets(spawnConfig, 'spawnConfig', 'Factory Settings.Agent')
      assertKnownSecretRefs(spawnConfig, 'spawnConfig', context.repos.secrets)
    }
    return c.json(
      publicAgent(context.repos.agents.update(c.req.param('id') as never, {
        model: body.model === undefined && !hasRefInput ? undefined : runtime.model,
        harness: body.harness === undefined && !hasRefInput ? undefined : runtime.harness,
        providerId,
        accountId,
        resourceRefs: hasRefInput ? nextRefs : undefined,
        capabilities: optionalStringArray(body.capabilities, 'capabilities') as never,
        effort: body.effort === undefined && body.model === undefined && !hasRefInput ? undefined : runtime.effort,
        costTier: typeof body.costTier === 'number'
          ? body.costTier
          : body.model !== undefined || hasRefInput
            ? runtime.defaultCostTier
            : undefined,
        spawnConfig,
        ...(pricing !== undefined ? { pricing } : {}),
      })),
    )
  })

  app.delete('/api/agents/:id', (c) => {
    const agentId = c.req.param('id')
    if (context.repos.agents.get(agentId as never) == null) {
      throw new NotFoundError(`Agent not found: ${agentId}`)
    }
    context.repos.agents.delete(agentId as never)
    return c.body(null, 204)
  })
}

function hasAgentResourceRefInput(body: Record<string, unknown>): boolean {
  return body.resourceRefs !== undefined
    || body.modelRef !== undefined
    || body.harnessRef !== undefined
    || body.workflowProfileRef !== undefined
    || body.sandboxRef !== undefined
    || body.systemPromptRef !== undefined
    || body.toolsRef !== undefined
    || body.policyRef !== undefined
}

function nullableStringField(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!(field in body)) return undefined
  const value = body[field]
  if (value == null) return null
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function defaultAgentHealth(agents: Agent[]): AgentHealthState[] {
  return agents.map((agent) => ({
    agentId: agent.id,
    agentName: agent.name,
    recentFailures: 0,
    unhealthy: false,
    unhealthyUntil: null,
    unhealthyReason: null,
    lastFailureAt: null,
  }))
}
