# Worker brief - phase2 agent provider/account identity

Repo worktree: `/Users/acartagena/project/dn-p2-agent-identity`
Branch: `stream/p2-agent-identity`
Suggested model: GPT 5.5
Migration reserved: `043_agent_provider_account_identity`

Authorized internal work. Do not push.

## Read first

- `AGENTS.md`
- `design/README.md`
- `design/ROADMAP.md` Phase 2
- `design/04-autonomy-recovery.md`
- `design/parallel/recovery-fixes.md`, especially Finding 8
- `packages/core/src/types.ts`
- `packages/core/src/repos/agent.ts`
- `packages/core/src/repos/interfaces.ts`
- `packages/core/src/dispatcher-cycle.ts`
- `packages/core/src/dispatcher-recovery.ts`
- `packages/api/src/routes/agents.ts`
- `packages/dashboard/src/api/client.ts`

## Problem

Recovery failover still uses harness as a proxy for provider/account identity. That
is wrong: two agents on the same exhausted account can ping-pong if they use different
harnesses, and two valid accounts on the same harness can be incorrectly treated as
the same provider.

## Task

Add explicit provider/account identity to Agent model/API/schema and use it in
recovery failover selection.

Expected shape:

- Add nullable `providerId` and `accountId` fields, or equivalent names already
  idiomatic to the repo.
- Persist them in the agents table with a guarded migration.
- Accept and return them through the API.
- Thread them through dashboard client types. UI fields are optional unless the
  existing Agent settings form has a simple local place to add them without broad UI work.
- Make `matchFailoverAgent` reject a candidate with the same provider/account identity
  as the failed agent.
- Preserve legacy behavior when identity is missing, but do not treat harness as a
  correct long-term identity.

## Tests

Add focused tests for:

- same harness, different account is a valid failover candidate
- different harness, same provider/account is not a valid failover candidate
- legacy agents with no provider/account keep current fallback behavior
- API create/update/list round-trips the new fields
- migration is idempotent

## Verification

Run and report exact output:

```sh
pnpm -C packages/core build
pnpm -C packages/core exec vitest run
pnpm -C packages/api build
pnpm -C packages/api exec vitest run
node scripts/check-file-size.mjs
```

Commit locally on `stream/p2-agent-identity`. Conventional commit subject. No AI
attribution. Do not push.

