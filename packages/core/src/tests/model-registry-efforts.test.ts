import { describe, expect, it } from 'vitest'

import { MODEL_REGISTRY, resolveModelEntry } from '../index.js'
import { CLAUDE_SENDABLE_EFFORTS, CODEX_SENDABLE_EFFORTS } from '../type-values.js'

// Effort parity tests for the catalog: the supportedEfforts list on a
// catalog entry must (a) only contain values the wired harness can
// actually send, and (b) for OpenAI models that document a `none`
// reasoning effort in their Reasoning API docs, explicitly document
// why Ductum cannot route `none` (Codex `model_reasoning_effort` does
// not accept it). Split from model-registry.test.ts so each file stays
// under the 300 LOC file-size gate.
describe('MODEL_REGISTRY effort parity', () => {
  // OpenAI gpt-5.5/5.4/5.4-mini/5.4-nano Reasoning API documents `none`
  // (https://developers.openai.com/api/docs/guides/reasoning - supported
  // values are model-dependent and can include none, minimal, low,
  // medium, high, and xhigh). But Ductum routes through
  // codex-app-server, whose `model_reasoning_effort` accepts only
  // minimal|low|medium|high|xhigh
  // (https://developers.openai.com/codex/config-reference). `none` is
  // only valid for Codex `plan_mode_reasoning_effort`, which Ductum
  // does not configure separately. Catalog entries for these models
  // MUST omit `none` from supportedEfforts AND carry an operator-facing
  // note explaining the harness limit - otherwise an operator reading
  // the OpenAI docs would assume `none` is sendable.
  it('documents why codex-app-server-routed OpenAI catalog entries cannot send the documented `none` reasoning effort', () => {
    const codexRoutedOpenAIFamilies = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']
    for (const id of codexRoutedOpenAIFamilies) {
      const entry = resolveModelEntry(id)
      expect(entry, `id=${id}`).not.toBeNull()
      expect(entry!.supportedHarnesses, `id=${id}`).toContain('codex-app-server')
      expect(entry!.supportedEfforts ?? [], `id=${id}`).not.toContain('none')
      expect(entry!.note ?? '', `id=${id}`).toMatch(/none/i)
      expect(entry!.note ?? '', `id=${id}`).toMatch(/model_reasoning_effort|codex/i)
    }
  })

  // Catalog supportedEfforts for codex-app-server-routed models must
  // all be sendable by `normalizeCodexEffort`
  // (packages/harness/src/codex-model.ts) - otherwise a configured
  // effort would be silently dropped at the SDK boundary. The harness
  // imports CODEX_SENDABLE_EFFORTS from core/type-values.ts, so this
  // test reads the same source of truth the adapter uses — no drift.
  it('keeps Codex-routed catalog efforts within what the Codex harness can send', () => {
    const codexRouted = MODEL_REGISTRY.filter((e) => e.supportedHarnesses.includes('codex-app-server'))
    expect(codexRouted.length).toBeGreaterThan(0)
    for (const entry of codexRouted) {
      for (const effort of entry.supportedEfforts ?? []) {
        expect(CODEX_SENDABLE_EFFORTS, `id=${entry.id} effort=${effort}`).toContain(effort)
      }
    }
  })

  // Catalog supportedEfforts for claude-agent-sdk-routed models must
  // all be sendable by `normalizeClaudeEffort`
  // (packages/harness/src/claude.ts), which imports
  // CLAUDE_SENDABLE_EFFORTS from core/type-values.ts. GLM 5.2 is
  // routed through the Claude-compatible path and inherits the same
  // effort set as Claude.
  it('keeps Claude-routed catalog efforts within what the Claude harness can send', () => {
    const claudeRouted = MODEL_REGISTRY.filter((e) => e.supportedHarnesses.includes('claude-agent-sdk'))
    expect(claudeRouted.length).toBeGreaterThan(0)
    for (const entry of claudeRouted) {
      for (const effort of entry.supportedEfforts ?? []) {
        expect(CLAUDE_SENDABLE_EFFORTS, `id=${entry.id} effort=${effort}`).toContain(effort)
      }
    }
  })

  it('keeps GLM 5.2 efforts aligned with the Claude-compatible harness mapping', () => {
    // GLM 5.2 routes through Claude Code compatible tooling, so its
    // supportedEfforts must be a subset of what the Claude harness
    // accepts (low|medium|high|xhigh|max). Z.AI's Coding Plan docs do
    // not publish a separate reasoning-effort enum; the model note
    // documents the low/medium/high → GLM high and xhigh/max → GLM max
    // mapping.
    const glm = resolveModelEntry('glm-5.2')
    expect(glm?.supportedHarnesses).toEqual(['claude-agent-sdk'])
    expect(glm?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(glm?.note).toMatch(/low\/medium\/high map to GLM high/)
    expect(glm?.note).toMatch(/xhigh\/max map to GLM max/)
  })
})
