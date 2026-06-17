import { describe, expect, it } from 'vitest'

import {
  collectWorkflowReadPathCandidates,
  extractWorkflowReadPath,
  isSimpleWorkflowReadCommand,
} from '../shell-read-detection.js'

describe('shell read detection', () => {
  it('extracts simple shell-wrapped file reads', () => {
    expect(extractWorkflowReadPath('/bin/zsh -lc "sed -n \'1,80p\' README.md"')).toBe('README.md')
    expect(extractWorkflowReadPath('rg -n Ductum packages/core/src/enforce.ts')).toBe('packages/core/src/enforce.ts')
    expect(isSimpleWorkflowReadCommand('/bin/zsh -lc "sed -n \'1,80p\' README.md"')).toBe(true)
  })

  it('extracts README from compound read-only exploration commands', () => {
    const command = "/bin/zsh -lc \"printf '--- README.md ---\\n'; sed -n '1,220p' README.md; printf '\\n--- AGENTS.md ---\\n'; sed -n '1,80p' AGENTS.md\""
    expect(collectWorkflowReadPathCandidates(command)).toEqual(['README.md', 'AGENTS.md'])
    expect(extractWorkflowReadPath(command)).toBe('README.md')
    expect(isSimpleWorkflowReadCommand(command)).toBe(false)
  })

  it('keeps README evidence when read-only exploration includes shell loop scaffolding', () => {
    const command = "/bin/zsh -lc \"pwd && ls -la && printf '\\n--- README.md ---\\n' && sed -n '1,220p' README.md && for f in decisions/053* decisions/054*; do echo \\\"\\n### $f ###\\\"; sed -n '1,80p' \\\"$f\\\"; done\""
    expect(extractWorkflowReadPath(command)).toBe('README.md')
    expect(extractWorkflowReadPath('/bin/zsh -lc "sed -n \'1,220p\' README.md && for f in decisions/053* decisions/054*; do [ -f \\"$f\\" ] || continue; printf \\"\\n### %s ###\\\\n\\" \\"$f\\"; sed -n \'1,80p\' \\"$f\\"; done"')).toBe('README.md')
    expect(extractWorkflowReadPath('/bin/zsh -lc "sed -n \'1,220p\' README.md && for f in decisions/053* decisions/054*; do if [ -f \\"$f\\" ]; then sed -n \'1,80p\' \\"$f\\"; fi; done"')).toBe('README.md')
  })

  it('does not infer a workflow read from mixed or mutating commands', () => {
    expect(extractWorkflowReadPath("/bin/zsh -lc \"sed -n '1,80p' README.md; pnpm test\"")).toBeNull()
    expect(extractWorkflowReadPath("/bin/zsh -lc \"sed -n '1,80p' README.md; rm README.md\"")).toBeNull()
    expect(extractWorkflowReadPath('cat README.md | tee /tmp/out.txt')).toBeNull()
    expect(extractWorkflowReadPath('/bin/zsh -lc "if rm README.md; then cat README.md; fi"')).toBeNull()
    expect(extractWorkflowReadPath('/bin/zsh -lc "for f in decisions/*; do rm \"$f\"; done"')).toBeNull()
    expect(extractWorkflowReadPath('/bin/zsh -lc "cat README.md && for f in decisions/*; do [ -f \"$f\" ] || continue; rm \"$f\"; done"')).toBeNull()
  })

  it('keeps ambiguous multi-file reads without README unclassified', () => {
    expect(extractWorkflowReadPath('cat packages/core/package.json && cat packages/api/package.json')).toBeNull()
  })

  it('extracts SPEC and AGENTS from target-aware context reads without README', () => {
    const command = "/bin/zsh -lc \"sed -n '1,220p' SPEC.md && sed -n '1,180p' AGENTS.md\""
    expect(collectWorkflowReadPathCandidates(command)).toEqual(['SPEC.md', 'AGENTS.md'])
    expect(extractWorkflowReadPath(command)).toBe('SPEC.md')
  })

  it('handles Codex target inspection with stderr discard and fallback true', () => {
    const command = "/bin/zsh -lc \"pwd && ls -la && printf '\\nqratum?\\n' && ls -la /Users/acartagena/project/qratum 2>/dev/null || true && printf '\\nRead AGENTS/README current\\n' && sed -n '1,220p' AGENTS.md && printf '\\n--- README ---\\n' && sed -n '1,240p' README.md\""
    expect(collectWorkflowReadPathCandidates(command)).toEqual(['AGENTS.md', 'README.md'])
    expect(extractWorkflowReadPath(command)).toBe('AGENTS.md')
  })

  it('recognises bare env in a read-only pipeline as non-mutating', () => {
    const command = "/bin/zsh -lc \"pwd && echo '--- README.md ---' && sed -n '1,200p' README.md && echo '--- CLAUDE.md ---' && sed -n '1,200p' CLAUDE.md && echo '--- env task hints ---' && env | grep -E 'DUCTUM|TASK|RUN|CODEX' | sort\""
    expect(collectWorkflowReadPathCandidates(command)).toEqual(['README.md', 'CLAUDE.md'])
    expect(extractWorkflowReadPath(command)).toBe('README.md')
    expect(isSimpleWorkflowReadCommand(command)).toBe(false)
  })

  it('treats bare env piped to grep as read-only', () => {
    expect(collectWorkflowReadPathCandidates('env | grep PATH')).toEqual([])
    expect(collectWorkflowReadPathCandidates('env | sort')).toEqual([])
    expect(collectWorkflowReadPathCandidates('env | grep -E FOO | sort')).toEqual([])
    expect(collectWorkflowReadPathCandidates("find . -type f | sed 's#^./##' | head")).toEqual([])
  })

  it('fails closed when env has arguments (arbitrary program execution)', () => {
    expect(extractWorkflowReadPath('env python script.py')).toBeNull()
    expect(extractWorkflowReadPath('env VAR=value command')).toBeNull()
    expect(extractWorkflowReadPath('env -i /bin/sh -c "rm -rf /"')).toBeNull()
    expect(extractWorkflowReadPath("sed -n '1,80p' README.md && env node evil.js")).toBeNull()
  })
})
