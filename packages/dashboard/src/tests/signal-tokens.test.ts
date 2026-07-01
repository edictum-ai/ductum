import { describe, expect, it } from 'vitest'

import {
  AA_NORMAL,
  agentColor,
  DARK_SURFACES,
  DARK_TEXT_TOKENS,
  LIGHT_SURFACES,
  LIGHT_TEXT_TOKENS,
  statusOf,
  toneBadgeClass,
  toneColor,
  toneTextClass,
  tokens,
  composite,
  contrastRatio,
} from '@/components/signal'
import {
  evidenceTone,
  gateTone,
  stageLabel,
  latchTone,
  specStatusTone,
  stageTone,
  taskStatusLabel,
  taskStatusTone,
  toolTone,
} from '@/lib/stage-display'

const AGENT_PALETTE = [tokens.mimi, tokens.codex, tokens.glm, tokens.haiku]

/** Minimal run shape for statusOf — only the fields it reads. */
function run(fields: Record<string, unknown>): Parameters<typeof statusOf>[0] {
  return { pendingApproval: false, ...fields } as Parameters<typeof statusOf>[0]
}

describe('agentColor — deterministic hash, no hardcoded roster', () => {
  it('falls back to mid for empty/missing ids', () => {
    expect(agentColor(null)).toBe(tokens.mid)
    expect(agentColor(undefined)).toBe(tokens.mid)
    expect(agentColor('')).toBe(tokens.mid)
  })

  it('always maps a non-empty id onto the calm agent palette', () => {
    for (const id of ['mimi', 'codex', 'glm', 'haiku', 'gpt-5', 'sonnet', 'a', 'x'.repeat(40)]) {
      expect(AGENT_PALETTE).toContain(agentColor(id))
    }
  })

  it('gives the canonical roster their own mutually-distinct identity colors', () => {
    // Guards the agentColor regression: a pure hash over a 4-color palette
    // collides (mimi == glm). The roster must stay 1:1 with its brand tones.
    expect(agentColor('mimi')).toBe(tokens.mimi)
    expect(agentColor('codex')).toBe(tokens.codex)
    expect(agentColor('glm')).toBe(tokens.glm)
    expect(agentColor('haiku')).toBe(tokens.haiku)
    const roster = ['mimi', 'codex', 'glm', 'haiku'].map(agentColor)
    expect(new Set(roster).size).toBe(4)
  })

  it('is stable for a repeated (even unknown) id', () => {
    expect(agentColor('some-new-agent')).toBe(agentColor('some-new-agent'))
    expect(agentColor('another-agent-42')).toBe(agentColor('another-agent-42'))
  })

  it('is case-insensitive', () => {
    expect(agentColor('Codex')).toBe(agentColor('codex'))
    expect(agentColor('MIMI')).toBe(agentColor('mimi'))
  })

  it('spreads ids across more than one palette entry', () => {
    const seen = new Set(
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'].map(agentColor),
    )
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('tone → token bridges', () => {
  it('toneColor maps each tone to its signal var', () => {
    expect(toneColor('ok')).toBe(tokens.ok)
    expect(toneColor('warn')).toBe(tokens.warn)
    expect(toneColor('err')).toBe(tokens.err)
    expect(toneColor('info')).toBe(tokens.info)
    expect(toneColor('accent')).toBe(tokens.accent)
    expect(toneColor('mid')).toBe(tokens.mid)
  })

  it('toneBadgeClass / toneTextClass produce the css-var-backed tone classes', () => {
    expect(toneBadgeClass('ok')).toBe('sig-tone sig-tone-ok')
    expect(toneBadgeClass('err')).toBe('sig-tone sig-tone-err')
    expect(toneTextClass('warn')).toBe('sig-tone-text sig-tone-warn')
    expect(toneTextClass('accent')).toBe('sig-tone-text sig-tone-accent')
  })
})

describe('status → tone mappers (the consolidated stage-display layer)', () => {
  it('stage: in-flight reads info, terminals read their semantic tone', () => {
    expect(stageTone('understand')).toBe('info')
    expect(stageTone('implement')).toBe('info')
    expect(stageTone('ship')).toBe('info')
    expect(stageTone('done')).toBe('ok')
    expect(stageTone('failed')).toBe('err')
    expect(stageTone('stalled')).toBe('warn')
    expect(stageTone('???')).toBe('mid')
  })

  it('humanizes representative stage/status labels instead of leaking raw enums', () => {
    expect(stageLabel('review')).toBe('Reviewing')
    expect(stageLabel('verify')).toBe('Verifying')
    expect(stageLabel('awaiting_approval')).toBe('Awaiting approval')
    expect(taskStatusLabel('in-progress')).toBe('In progress')
  })

  it('task status', () => {
    expect(taskStatusTone('done')).toBe('ok')
    expect(taskStatusTone('failed')).toBe('err')
    expect(taskStatusTone('blocked')).toBe('warn')
    expect(taskStatusTone('ready')).toBe('info')
    expect(taskStatusTone('pending')).toBe('mid')
  })

  it('spec status', () => {
    expect(specStatusTone('approved')).toBe('ok')
    expect(specStatusTone('done')).toBe('ok')
    expect(specStatusTone('failed')).toBe('err')
    expect(specStatusTone('reviewed')).toBe('info')
    expect(specStatusTone('draft')).toBe('mid')
  })

  it('evidence / gate / latch / tool', () => {
    expect(evidenceTone('review')).toBe('ok')
    expect(evidenceTone('lint')).toBe('warn')
    expect(evidenceTone('ci')).toBe('info')
    expect(gateTone('allowed')).toBe('ok')
    expect(gateTone('blocked')).toBe('err')
    expect(gateTone('pending')).toBe('warn')
    expect(latchTone('pass')).toBe('ok')
    expect(latchTone('fail')).toBe('err')
    expect(latchTone('weird')).toBe('mid')
    expect(toolTone('Write')).toBe('ok')
    expect(toolTone('Bash')).toBe('warn')
    expect(toolTone('Agent')).toBe('info') // accent stays rationed for "act here"
    expect(toolTone('Read')).toBe('info')
    expect(toolTone('Unknown')).toBe('mid')
  })
})

describe('statusOf — dashboard run-state rendering stays correct', () => {
  it('renders quarantined runs as a failed-tone terminal state', () => {
    expect(statusOf(run({ terminalState: 'quarantined', stage: 'implement' }))).toEqual({
      kind: 'failed',
      label: 'Quarantined',
      tone: 'err',
    })
  })

  it('renders failed / stalled / done with their brand tones', () => {
    expect(statusOf(run({ terminalState: 'failed', stage: 'implement' }))).toMatchObject({ label: 'Failed', tone: 'err' })
    expect(statusOf(run({ terminalState: 'stalled', stage: 'implement' }))).toMatchObject({ label: 'Stalled', tone: 'warn' })
    expect(statusOf(run({ terminalState: null, stage: 'done' }))).toMatchObject({ kind: 'done', label: 'Done', tone: 'ok' })
  })

  it('honors the backend UI contract tone when present', () => {
    const ui = { status: { key: 'quarantined', label: 'Quarantined', tone: 'err' } }
    expect(statusOf(run({ terminalState: 'quarantined', stage: 'implement', ui }))).toMatchObject({
      kind: 'failed',
      tone: 'err',
    })
  })
})

/* WCAG AA contrast for small dim/faint mono text.
 *
 * The Signal theme renders small mono labels (Caps, Mono size 10-12) in
 * dim/faint over one of four surface tokens (bg/canvas/sunken/raised).
 * WCAG AA requires 4.5:1 contrast for body text. This test enumerates
 * every (token, surface) pair the small labels actually live on and
 * fails if any drop below the threshold, so a future alpha tweak that
 * silently ships a regression is caught here, not in a v2 audit. The
 * surface + token literals are mirrored from index.css via signal/wcag.ts.
 */

describe('WCAG AA contrast for small dim/faint signal text', () => {
  const surfaces = [
    ['bg', DARK_SURFACES.bg],
    ['canvas', DARK_SURFACES.canvas],
    ['sunken', DARK_SURFACES.sunken],
    ['raised', DARK_SURFACES.raised],
  ] as const

  for (const [surfaceName, surface] of surfaces) {
    for (const tokenName of ['dim', 'faint'] as const) {
      it(`dark ${tokenName} on ${surfaceName} meets AA (4.5:1)`, () => {
        const effective = composite(DARK_TEXT_TOKENS[tokenName], surface)
        const ratio = contrastRatio(effective, surface)
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL)
      })
    }
  }

  const lightSurfaces = [
    ['bg', LIGHT_SURFACES.bg],
    ['canvas', LIGHT_SURFACES.canvas],
    ['sunken', LIGHT_SURFACES.sunken],
    ['raised', LIGHT_SURFACES.raised],
  ] as const

  for (const [surfaceName, surface] of lightSurfaces) {
    for (const tokenName of ['dim', 'faint'] as const) {
      it(`light ${tokenName} on ${surfaceName} meets AA (4.5:1)`, () => {
        const effective = composite(LIGHT_TEXT_TOKENS[tokenName], surface)
        const ratio = contrastRatio(effective, surface)
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL)
      })
    }
  }

  it('AA threshold constant is the WCAG 2.1 normal-text value', () => {
    expect(AA_NORMAL).toBe(4.5)
  })
})

describe('tokens bridge the WCAG literal constants to CSS variables', () => {
  it('dim/faint are exposed as CSS variable references, not hardcoded colors', () => {
    // The TS tokens are CSS var references so the WCAG constants in wcag.ts
    // are the only place the literal alpha values live for the test to read.
    expect(tokens.dim).toBe('var(--signal-dim)')
    expect(tokens.faint).toBe('var(--signal-faint)')
  })
})
