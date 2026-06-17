# P15 - Codex App Server Split And Complete

## Problem

Run `7OqZDPrgAhLr` produced useful commit `8b8e10a`, but the attempt was
operator-closed as failed because it left two product blockers:

- `packages/harness/src/codex-app-server.ts` is still over the repo 300 LOC
  limit after being edited;
- the agent recorded evidence but did not call `ductum.complete`, leaving the
  run stuck in `implement`.

## Behavior Contract

- Reuse the current `codex-elicitation-request-handling` lineage worktree.
- Rebase onto current `main` before editing or verifying.
- Split `packages/harness/src/codex-app-server.ts` below 300 LOC without
  changing the protocol behavior from commit `8b8e10a`.
- Preserve the JSON-RPC `jsonrpc: "2.0"` error response fix.
- Preserve Ductum-visible `tool.blocked.reason` activity content.
- Preserve shaped non-interactive responses for Codex permissions, auth
  refresh, dynamic tool call, apply-patch approval, exec-command approval, MCP
  elicitation, and user-input requests.
- Do not add dependencies, tables, or policy paths.
- Finish by calling `ductum.complete` with a concrete summary after committing
  and recording evidence. Do not stop at `ductum.update` or `ductum.gate_check`.

## Verification

```sh
pnpm --filter @ductum/harness test -- codex
pnpm build
pnpm test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

Also run:

```sh
wc -l packages/harness/src/codex-app-server.ts packages/harness/src/codex-server-request-routing.ts packages/harness/src/tests/codex-server-request-routing.test.ts
```

Every edited or newly added source/test file must be under 300 LOC.

## Decision Trace

- Decision `053`: Ductum state and evidence are the factory truth.
- Decision `054`: harness adapters normalize provider events without owning
  policy.
- Decision `060`: drift from dogfood must become explicit task evidence.
- Decision `108`: execution integrity and operator-visible recovery are core.

## Slop Review

- Attack any behavior regression hidden behind a file split.
- Attack completion that records notes but does not terminate through
  `ductum.complete`.
- Attack approval readiness if branch does not contain current `main`.
