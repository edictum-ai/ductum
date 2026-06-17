# P14 - Codex Elicitation Approval Recovery

## Problem

Approval for run `xQ0s_auoZ4Oj` was blocked because branch
`ductum/codex-elicitation-request-handling-xQ0s_a` no longer contained current
`main`.

The previous implementation also still needs hardening from review:

- split the new Codex server-response tests so edited files stay under repo
  size limits;
- keep `codex-app-server.ts` from growing further where practical;
- surface `tool.blocked.reason` in Ductum-visible activity, including MCP
  server name and elicitation message when available;
- add routing/activity coverage, not only pure response-shaper coverage;
- keep auth refresh, dynamic tool call, permission approval, apply-patch
  approval, exec-command approval, MCP elicitation, and user-input requests
  protocol-valid and non-interactive.

## Behavior Contract

- Reuse the existing lineage worktree for
  `codex-elicitation-request-handling`; do not start an unrelated rewrite.
- Rebase the branch onto current `main` before verification.
- Do not auto-approve permissions, fabricate auth tokens, or make MCP
  elicitation interactive by default.
- Unsupported future server requests must fail with an explicit JSON-RPC error,
  not `{}`.
- `authorize_tool` remains harness-internal and `gate_check` remains
  agent-visible/read-only. Do not add tables, dependencies, or a second policy
  path.
- The final approval branch must contain current `main`.

## Verification

```sh
pnpm --filter @ductum/harness test -- codex
pnpm build
pnpm test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

## Decision Trace

- Decision `053`: Specs, Tasks, Runs, Decisions, and Evidence are the factory
  truth.
- Decision `054`: harness adapters normalize provider events; they do not own
  policy.
- Decision `060`: dogfood drift becomes explicit task evidence.
- Decision `108`: execution integrity must be operator-visible and truthful.

## Slop Review

- Attack any generic `{}` fallback for a known shaped server request.
- Attack helper-only tests that do not prove app-server routing or activity
  evidence.
- Attack stale approval recovery that depends on direct database edits.
