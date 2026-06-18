/**
 * Single declarative model list (data only). Types and lookup helpers
 * live in `./model-registry.ts`. Adding a model means one entry here
 * and nothing else.
 *
 * Rate sources checked on 2026-06-13:
 *  - OpenAI: official model pages and Codex model docs.
 *  - Anthropic: official model overview, pricing, and Claude Code docs.
 *  - Z.AI: official pricing page (GLM-5.2 re-verified 2026-06-17) and GLM Coding Plan docs.
 */
import type { AgentEffort, Harness } from './types.js'
import type { ModelRegistryEntry, RegistryRates } from './model-registry.js'

const LAST_VERIFIED_AT = '2026-06-13'

const OPENAI_EFFORTS: AgentEffort[] = ['low', 'medium', 'high', 'xhigh']
const OPENAI_GPT5_EFFORTS: AgentEffort[] = ['minimal', 'low', 'medium', 'high']
const OPENAI_PRO_EFFORTS: AgentEffort[] = ['medium', 'high', 'xhigh']
const CLAUDE_EFFORTS: AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const CLAUDE_HIGH_MAX_EFFORTS: AgentEffort[] = ['low', 'medium', 'high', 'max']
const CODEX_HARNESSES: Harness[] = ['codex-sdk', 'codex-app-server']
const CLAUDE_HARNESSES: Harness[] = ['claude-agent-sdk']

const OPENAI_CODEX_MODELS_SOURCE = 'https://developers.openai.com/codex/models'
const OPENAI_GPT55_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.5'
const OPENAI_GPT55_PRO_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.5-pro'
const OPENAI_GPT54_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.4'
const OPENAI_GPT54_PRO_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.4-pro'
const OPENAI_GPT54_MINI_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.4-mini'
const OPENAI_GPT54_NANO_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.4-nano'
const OPENAI_GPT53_CODEX_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.3-codex'
const OPENAI_GPT52_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.2'
const OPENAI_GPT51_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5.1'
const OPENAI_GPT5_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5'
const OPENAI_O3_SOURCE = 'https://developers.openai.com/api/docs/models/o3'
const OPENAI_O3_MINI_SOURCE = 'https://developers.openai.com/api/docs/models/o3-mini'
const ANTHROPIC_MODELS_SOURCE = 'https://platform.claude.com/docs/en/about-claude/models/overview'
const ANTHROPIC_FABLE_SOURCE = 'https://platform.claude.com/docs/id/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5'
const ANTHROPIC_PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'
const ZAI_PRICING_SOURCE = 'https://docs.z.ai/guides/overview/pricing'
const ZAI_CLAUDE_CODE_SOURCE = 'https://docs.z.ai/devpack/tool/claude'
const ZAI_CODING_PLAN_SOURCE = 'https://docs.z.ai/devpack/faq'
const ZAI_LATEST_MODEL_SOURCE = 'https://docs.z.ai/devpack/latest-model'

function rates(inputPer1M: number, outputPer1M: number, cachedReadPer1M?: number, cacheCreationPer1M?: number): RegistryRates {
  return {
    inputPerToken: inputPer1M / 1_000_000,
    outputPerToken: outputPer1M / 1_000_000,
    ...(cachedReadPer1M == null ? {} : { cachedReadPerToken: cachedReadPer1M / 1_000_000 }),
    ...(cacheCreationPer1M == null ? {} : { cacheCreationPerToken: cacheCreationPer1M / 1_000_000 }),
  }
}

function model(entry: Omit<ModelRegistryEntry, 'lastVerifiedAt'>): ModelRegistryEntry {
  return { lastVerifiedAt: LAST_VERIFIED_AT, ...entry }
}

const zAiMeasured = (input: number, output: number, cached: number): RegistryRates => rates(input, output, cached, 0)

export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  model({ id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai', availability: 'codex',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/gpt-5.5'], defaultCostTier: 95, sourceUrl: OPENAI_GPT55_SOURCE,
    note: 'Recommended OpenAI Codex model for complex coding and professional work.',
    scannerKind: 'codex', rates: rates(5, 30, 0.5) }),
  model({ id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', provider: 'openai', availability: 'api',
    supportedHarnesses: [],
    aliases: ['openai/gpt-5.5-pro'], defaultCostTier: 100, sourceUrl: OPENAI_GPT55_PRO_SOURCE,
    note: 'Responses API pro model; no Ductum harness route is currently proven.',
    scannerKind: 'none', rates: rates(30, 180, 30) }),
  model({ id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', availability: 'codex',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/gpt-5.4'], defaultCostTier: 85, sourceUrl: OPENAI_GPT54_SOURCE,
    note: 'Recommended OpenAI Codex frontier model for professional work.',
    scannerKind: 'codex', rates: rates(2.5, 15, 0.25) }),
  model({ id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro', provider: 'openai', availability: 'api',
    supportedHarnesses: [], supportedEfforts: OPENAI_PRO_EFFORTS,
    aliases: ['openai/gpt-5.4-pro'], defaultCostTier: 98, sourceUrl: OPENAI_GPT54_PRO_SOURCE,
    note: 'Responses API pro model; no Ductum harness route is currently proven.',
    scannerKind: 'none', rates: rates(30, 180, 30) }),
  model({ id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'openai', availability: 'codex',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/gpt-5.4-mini'], defaultCostTier: 55, sourceUrl: OPENAI_GPT54_MINI_SOURCE,
    note: 'Recommended OpenAI Codex lower-latency model for subagents.',
    scannerKind: 'none', rates: rates(0.75, 4.5, 0.075) }),
  model({ id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', provider: 'openai', availability: 'api',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/gpt-5.4-nano'], defaultCostTier: 25, sourceUrl: OPENAI_GPT54_NANO_SOURCE,
    note: 'Small GPT-5.4-class API model for cheap checks and subagents.',
    scannerKind: 'none', rates: rates(0.2, 1.25, 0.02) }),
  model({ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai', availability: 'deprecated',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/gpt-5.3-codex'], defaultCostTier: 75, sourceUrl: OPENAI_GPT53_CODEX_SOURCE,
    note: 'Deprecated for ChatGPT-sign-in Codex, but still listed on the API model page.',
    scannerKind: 'codex', rates: rates(1.75, 14, 0.175) }),
  model({ id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', provider: 'openai', availability: 'research-preview',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/gpt-5.3-codex-spark'], defaultCostTier: 58, sourceUrl: OPENAI_CODEX_MODELS_SOURCE,
    note: 'Research-preview Codex model available to ChatGPT Pro users.',
    scannerKind: 'codex',
    pricingNote: 'OpenAI Codex docs do not publish token pricing for this research-preview model.' }),
  model({ id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai', availability: 'deprecated',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/gpt-5.2'], defaultCostTier: 65, sourceUrl: OPENAI_GPT52_SOURCE,
    note: 'Deprecated for ChatGPT-sign-in Codex, but still listed on the API model page.',
    scannerKind: 'codex', rates: rates(1.75, 14, 0.175) }),
  model({ id: 'gpt-5.1', label: 'GPT-5.1', provider: 'openai', availability: 'api',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: ['low', 'medium', 'high'],
    aliases: ['openai/gpt-5.1'], defaultCostTier: 62, sourceUrl: OPENAI_GPT51_SOURCE,
    note: 'API model retained for workflows pinned before the latest Codex recommendations.',
    scannerKind: 'codex', rates: rates(1.25, 10, 0.125) }),
  model({ id: 'gpt-5', label: 'GPT-5', provider: 'openai', availability: 'api',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_GPT5_EFFORTS,
    aliases: ['openai/gpt-5'], defaultCostTier: 60, sourceUrl: OPENAI_GPT5_SOURCE,
    note: 'Earlier GPT-5 generation.',
    scannerKind: 'codex', rates: rates(1.25, 10, 0.125) }),
  model({ id: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'openai', availability: 'api',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_GPT5_EFFORTS,
    aliases: ['openai/gpt-5-mini'], defaultCostTier: 30, sourceUrl: OPENAI_GPT5_SOURCE,
    note: 'Earlier GPT-5 mini.',
    scannerKind: 'codex', rates: rates(0.25, 2, 0.025) }),
  model({ id: 'gpt-5-nano', label: 'GPT-5 nano', provider: 'openai', availability: 'api',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_GPT5_EFFORTS,
    aliases: ['openai/gpt-5-nano'], defaultCostTier: 15, sourceUrl: OPENAI_GPT5_SOURCE,
    note: 'Earlier GPT-5 nano.',
    scannerKind: 'codex', rates: rates(0.05, 0.4, 0.005) }),
  model({ id: 'o3', label: 'o3', provider: 'openai', availability: 'api',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/o3'], defaultCostTier: 50, sourceUrl: OPENAI_O3_SOURCE,
    note: 'OpenAI o3 reasoning model.',
    scannerKind: 'codex', rates: rates(2, 8, 0.5) }),
  model({ id: 'o3-mini', label: 'o3-mini', provider: 'openai', availability: 'api',
    supportedHarnesses: CODEX_HARNESSES, supportedEfforts: OPENAI_EFFORTS,
    aliases: ['openai/o3-mini'], defaultCostTier: 35, sourceUrl: OPENAI_O3_MINI_SOURCE,
    note: 'OpenAI o3-mini reasoning model; the dated snapshot is deprecated, not the base model.',
    scannerKind: 'codex', rates: rates(1.1, 4.4, 0.55) }),
  model({ id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic', availability: 'deprecated',
    supportedHarnesses: [], supportedEfforts: CLAUDE_EFFORTS,
    aliases: ['claude-fable-5'], defaultCostTier: 96, sourceUrl: ANTHROPIC_FABLE_SOURCE,
    note: 'Access suspended June 12, 2026; use Claude Opus 4.8 or another model.',
    scannerKind: 'claude', rates: rates(10, 50, 1, 12.5) }),
  model({ id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic', availability: 'subscription',
    supportedHarnesses: CLAUDE_HARNESSES, supportedEfforts: CLAUDE_EFFORTS,
    aliases: ['claude-opus-4.8'], defaultCostTier: 92, sourceUrl: ANTHROPIC_MODELS_SOURCE,
    note: 'Latest Opus-tier Claude model for Claude Agent SDK routing.',
    scannerKind: 'claude', rates: rates(5, 25, 0.5, 6.25) }),
  model({ id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', availability: 'subscription',
    supportedHarnesses: CLAUDE_HARNESSES, supportedEfforts: CLAUDE_EFFORTS,
    aliases: ['claude-opus-4.7'], defaultCostTier: 90, sourceUrl: ANTHROPIC_PRICING_SOURCE,
    note: 'Kept for existing agents; Opus 4.8 is the current upgrade.',
    scannerKind: 'claude', rates: rates(5, 25, 0.5, 6.25) }),
  model({ id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', availability: 'subscription',
    supportedHarnesses: CLAUDE_HARNESSES, supportedEfforts: CLAUDE_HIGH_MAX_EFFORTS,
    aliases: ['claude-opus-4.6'], defaultCostTier: 88, sourceUrl: ANTHROPIC_PRICING_SOURCE,
    note: 'Kept for existing agents; Claude Code effort levels are documented for Opus 4.6 and later.',
    scannerKind: 'claude', rates: rates(5, 25, 0.5, 6.25) }),
  model({ id: 'claude-opus-4-5', label: 'Claude Opus 4.5', provider: 'anthropic', availability: 'subscription',
    supportedHarnesses: CLAUDE_HARNESSES, aliases: ['claude-opus-4.5'], defaultCostTier: 86,
    sourceUrl: ANTHROPIC_PRICING_SOURCE, note: 'Earlier Opus generation.',
    scannerKind: 'claude', rates: rates(5, 25, 0.5, 6.25) }),
  model({ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', availability: 'subscription',
    supportedHarnesses: CLAUDE_HARNESSES, supportedEfforts: CLAUDE_HIGH_MAX_EFFORTS,
    aliases: ['claude-sonnet-4.6'], defaultCostTier: 70, sourceUrl: ANTHROPIC_MODELS_SOURCE,
    note: 'Current Sonnet model for Claude Agent SDK routing.',
    scannerKind: 'claude', rates: rates(3, 15, 0.3, 3.75) }),
  model({ id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', availability: 'subscription',
    supportedHarnesses: CLAUDE_HARNESSES, aliases: ['claude-sonnet-4.5'], defaultCostTier: 68,
    sourceUrl: ANTHROPIC_PRICING_SOURCE, note: 'Earlier Sonnet generation.',
    scannerKind: 'claude', rates: rates(3, 15, 0.3, 3.75) }),
  model({ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', availability: 'subscription',
    supportedHarnesses: CLAUDE_HARNESSES, aliases: ['claude-haiku-4.5'], defaultCostTier: 32,
    sourceUrl: ANTHROPIC_MODELS_SOURCE, note: 'Current Haiku-class subagent model.',
    scannerKind: 'claude', rates: rates(1, 5, 0.1, 1.25) }),
  model({ id: 'glm-5.2', label: 'GLM-5.2', provider: 'zai', availability: 'coding-plan',
    supportedHarnesses: CLAUDE_HARNESSES, supportedEfforts: CLAUDE_EFFORTS,
    aliases: ['GLM-5.2', 'glm-5.2[1m]', 'GLM-5.2[1m]'], defaultCostTier: 82,
    sourceUrl: ZAI_PRICING_SOURCE,
    note: 'Premium Z.AI Coding Plan model supported through Claude Code model mapping; use [1m] in Claude Code env for 1M context. Claude Code efforts low/medium/high map to GLM high; xhigh/max map to GLM max. Official Z.AI pricing per 1M tokens: $1.40 input, $4.40 output, $0.26 cached input; cache creation/storage is limited-time free. Verified 2026-06-17 against https://docs.z.ai/guides/overview/pricing.',
    scannerKind: 'claude',
    rates: zAiMeasured(1.4, 4.4, 0.26) }),
  model({ id: 'glm-5.1', label: 'GLM-5.1', provider: 'zai', availability: 'coding-plan',
    supportedHarnesses: CLAUDE_HARNESSES, aliases: ['GLM-5.1'], defaultCostTier: 40,
    sourceUrl: ZAI_CODING_PLAN_SOURCE, note: 'Z.AI Coding Plan model supported through Claude Code model mapping.',
    scannerKind: 'claude', rates: zAiMeasured(1.4, 4.4, 0.26) }),
  model({ id: 'glm-5-turbo', label: 'GLM-5-Turbo', provider: 'zai', availability: 'coding-plan',
    supportedHarnesses: CLAUDE_HARNESSES, aliases: ['GLM-5-Turbo'], defaultCostTier: 34,
    sourceUrl: ZAI_CODING_PLAN_SOURCE, note: 'Z.AI Coding Plan model supported through Claude Code model mapping.',
    scannerKind: 'claude', rates: zAiMeasured(1.2, 4, 0.24) }),
  model({ id: 'glm-4.7', label: 'GLM-4.7', provider: 'zai', availability: 'coding-plan',
    supportedHarnesses: CLAUDE_HARNESSES, aliases: ['GLM-4.7'], defaultCostTier: 28,
    sourceUrl: ZAI_CLAUDE_CODE_SOURCE, note: 'Default Z.AI Coding Plan model for Claude Code compatible routing.',
    scannerKind: 'claude', rates: zAiMeasured(0.6, 2.2, 0.11) }),
  model({ id: 'glm-4.5-air', label: 'GLM-4.5-Air', provider: 'zai', availability: 'coding-plan',
    supportedHarnesses: CLAUDE_HARNESSES, aliases: ['GLM-4.5-Air'], defaultCostTier: 12,
    sourceUrl: ZAI_CODING_PLAN_SOURCE, note: 'Z.AI Coding Plan lightweight model supported through Claude Code model mapping.',
    scannerKind: 'claude', rates: zAiMeasured(0.2, 1.1, 0.03) }),
  model({ id: 'glm-5', label: 'GLM-5', provider: 'zai', availability: 'api',
    supportedHarnesses: [], aliases: ['GLM-5'], defaultCostTier: 30, sourceUrl: ZAI_PRICING_SOURCE,
    note: 'Z.AI API-priced model; not listed as supported by the GLM Coding Plan Claude Code mapping.',
    scannerKind: 'none', rates: zAiMeasured(1, 3.2, 0.2) }),
  model({ id: 'glm-5v-turbo', label: 'GLM-5V-Turbo', provider: 'zai', availability: 'api',
    supportedHarnesses: [], aliases: ['GLM-5V-Turbo'], defaultCostTier: 45, sourceUrl: ZAI_PRICING_SOURCE,
    note: 'Z.AI API-priced vision model; not listed as supported by the GLM Coding Plan Claude Code mapping.',
    scannerKind: 'none', rates: zAiMeasured(1.2, 4, 0.24) }),
  model({ id: 'glm-4.6', label: 'GLM-4.6', provider: 'zai', availability: 'api',
    supportedHarnesses: [], aliases: ['GLM-4.6'], defaultCostTier: 24, sourceUrl: ZAI_PRICING_SOURCE,
    note: 'Z.AI API-priced model; not listed as supported by the GLM Coding Plan Claude Code mapping.',
    scannerKind: 'none', rates: zAiMeasured(0.6, 2.2, 0.11) }),
  model({ id: 'glm-4.5', label: 'GLM-4.5', provider: 'zai', availability: 'api',
    supportedHarnesses: [], aliases: ['GLM-4.5'], defaultCostTier: 20, sourceUrl: ZAI_PRICING_SOURCE,
    note: 'Z.AI API-priced model; not listed as supported by the GLM Coding Plan Claude Code mapping.',
    scannerKind: 'none', rates: zAiMeasured(0.6, 2.2, 0.11) }),
]
