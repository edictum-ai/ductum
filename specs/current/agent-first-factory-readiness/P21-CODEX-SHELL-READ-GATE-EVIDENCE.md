# P21 - Codex Shell Read Gate Evidence

## Problem

Codex can inspect files through shell commands instead of the `Read` tool, so
Edictum's understand-stage read gate may not advance even though the agent saw
the file content. This makes Codex runs slower and sometimes stuck.

## Scope

- Write scope: Codex harness/tool evidence handling and tests.
- Do not change Edictum policy semantics.
- Do not add a second policy engine.
- Do not add dependencies.

## Behavior Contract

- Shell commands that are recognized as file reads must record equivalent read
  evidence through the existing enforcement path.
- The behavior must be conservative; arbitrary shell output must not count as a
  file read.
- Direct `Read` tool behavior must remain unchanged.
- The understand gate must advance for recognized shell reads of required files.

## Verification

```sh
pnpm --filter @ductum/core test -- shell-read-detection enforce
pnpm --filter @ductum/api test
pnpm build
git diff --check
```

## Decision Trace

- Decision `022`: MCP server is pre-bound per session.
- Decision `053`: evidence quality is core trust infrastructure.
- Decision `108`: live run state must reflect actual progress.

## Slop Review

- Attack broad shell-output inference.
- Attack duplicate policy logic outside Edictum.
- Attack tests that only prove direct `Read`, not shell-read recognition.
