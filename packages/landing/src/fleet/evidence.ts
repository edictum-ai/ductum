/* Authored evidence bundles per agent. Not generated. */

export interface EvidenceEntry {
  attempt: string
  json: string
}

/** Syntax-highlight class lookup for JSON values. */
export type TokenKind = 'k' | 's' | 'f' | 'd' | 'n'

export interface JsonToken {
  text: string
  kind: TokenKind
}

export const EVIDENCE: Record<string, EvidenceEntry> = {
  a1: {
    attempt: 'att-31',
    json: JSON.stringify(
      {
        run_id: 'run_7c1f3a',
        attempt_id: 'att-31',
        agent: 'agent-compile',
        state: 'done',
        turns: 9,
        commit: 'a1f3c2e',
        gate_verdicts: [
          { gate: 'read-before-edit', verdict: 'allow' },
          { gate: 'verify-before-push', verdict: 'allow' },
        ],
        tool_calls: ['read_file', 'edit_file', 'run_tests', 'read_file', 'git_commit'],
        policy: 'fail-closed by default',
      },
      null,
      2,
    ),
  },
  a2: {
    attempt: 'att-32',
    json: JSON.stringify(
      {
        run_id: 'run_7c1f3a',
        attempt_id: 'att-32',
        agent: 'agent-test',
        state: 'done',
        turns: 7,
        commit: 'b7e9d14',
        gate_verdicts: [{ gate: 'read-before-edit', verdict: 'allow' }],
        tool_calls: ['read_file', 'run_tests', 'run_tests'],
        policy: 'fail-closed by default',
      },
      null,
      2,
    ),
  },
  a3: {
    attempt: 'att-33',
    json: JSON.stringify(
      {
        run_id: 'run_7c1f3a',
        attempt_id: 'att-33',
        agent: 'agent-lint',
        state: 'done',
        turns: 4,
        commit: 'c2a8f90',
        gate_verdicts: [{ gate: 'read-before-edit', verdict: 'allow' }],
        tool_calls: ['read_file', 'edit_file', 'run_lint'],
        policy: 'fail-closed by default',
      },
      null,
      2,
    ),
  },
  a4: {
    attempt: 'att-34',
    json: JSON.stringify(
      {
        run_id: 'run_7c1f3a',
        attempt_id: 'att-34',
        agent: 'agent-migrate',
        state: 'failed',
        turns: 11,
        commit: null,
        retry: '2/3',
        gate_verdicts: [
          { gate: 'read-before-edit', verdict: 'allow' },
          { gate: 'verify-before-push', verdict: 'block' },
        ],
        finding: 'tests red · 3 failing · schema mismatch',
        tool_calls: [
          'read_file',
          'edit_file',
          'run_tests',
          'edit_file',
          'run_tests',
          'edit_file',
          'run_tests',
        ],
        policy: 'fail-closed · holding run',
      },
      null,
      2,
    ),
  },
  a5: {
    attempt: 'att-35',
    json: JSON.stringify(
      {
        run_id: 'run_7c1f3a',
        attempt_id: 'att-35',
        agent: 'agent-review',
        state: 'done',
        turns: 6,
        commit: 'd4f1b77',
        gate_verdicts: [{ gate: 'read-before-edit', verdict: 'allow' }],
        tool_calls: ['read_file', 'read_file', 'post_review'],
        policy: 'fail-closed by default',
      },
      null,
      2,
    ),
  },
  a6: {
    attempt: 'att-36',
    json: JSON.stringify(
      {
        run_id: 'run_7c1f3a',
        attempt_id: 'att-36',
        agent: 'agent-ship',
        state: 'queued',
        turns: 0,
        commit: null,
        held_by: 'gate · verify-before-push · BLOCK on att-34',
        gate_verdicts: [{ gate: 'ci-green-before-merge', verdict: 'block' }],
        tool_calls: [],
        policy: 'fail-closed · run held',
      },
      null,
      2,
    ),
  },
}

/**
 * Lightweight JSON syntax highlighter.
 * Tokenizes a JSON string into spans with kind classes for color styling.
 * k=blue (key), s=done/green (string), f=failed/red, d=ink-dim (null/brackets), n=queued.
 */
export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = []
  // Match: keys "..." : | strings "..." | numbers | booleans/null | punctuation
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(json)) !== null) {
    if (m[1] !== undefined) {
      // It's a quoted string — either a key or a value
      if (m[2] !== undefined) {
        // key
        tokens.push({ text: m[1], kind: 'k' })
        tokens.push({ text: m[2], kind: 'd' })
      } else {
        // string value — color by content (semantic highlighting)
        const val = m[1].slice(1, -1)
        if (val === 'failed' || val === 'block' || m[1].includes('failed') || m[1].includes('tests red')) {
          tokens.push({ text: m[1], kind: 'f' })
        } else if (val === 'null') {
          tokens.push({ text: m[1], kind: 'd' })
        } else {
          tokens.push({ text: m[1], kind: 's' })
        }
      }
    } else if (m[3] !== undefined) {
      tokens.push({ text: m[3], kind: 'n' })
    } else if (m[4] !== undefined) {
      tokens.push({ text: m[4], kind: 'd' })
    } else if (m[5] !== undefined) {
      tokens.push({ text: m[5], kind: 'd' })
    }
  }
  return tokens
}
