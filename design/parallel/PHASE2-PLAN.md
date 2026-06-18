# Parallel build plan - phase2

One orchestrator session owns `phase2`: review worker diffs, verify, merge, keep the
branch green, and never push. Worker sessions run in isolated worktrees on branches
off `phase2`; they commit locally and report exact verification output.

## Completed streams

These are merged into `phase2` and the completed local worktrees have been removed.

| Stream | Worktree | Branch | Suggested model | Migration reserved |
|---|---|---|---|---|
| A - Agent provider/account identity | `/Users/acartagena/project/dn-p2-agent-identity` | `stream/p2-agent-identity` | GPT 5.5 | `043_agent_provider_account_identity` |
| B - Real Podman sandbox driver | `/Users/acartagena/project/dn-p2-podman-sandbox` | `stream/p2-podman-sandbox` | GLM 5.2, with GPT 5.5 review | none expected |
| C - Transactional gate/evidence commit | `/Users/acartagena/project/dn-p2-gate-transaction` | `stream/p2-gate-transaction` | GPT 5.5 | `044_gate_commit_transactions` if needed |

## Active next stream

| Stream | Worktree | Branch | Suggested model | Migration reserved |
|---|---|---|---|---|
| D - Lease + fencing | `/Users/acartagena/project/dn-p2-lease-fencing` | `stream/p2-lease-fencing` | GPT 5.5 | `044_attempt_leases` |

## Deferred streams

Do not start these until the listed dependency lands in `phase2`.

| Stream | Start after | Suggested model | Why blocked |
|---|---|---|---|
| E - Reconciler | D | GPT 5.5 | Needs the lease/checkpoint ownership model to classify stale owners correctly. |
| F - Autonomy + legibility | E | GPT 5.5 | Needs reconciler and quarantine semantics before `whatToDoNext` is total. |

## Model assignment

Use GPT 5.5 for dispatcher/core durability work: agent identity, transactions,
leases/fencing, reconciler, and autonomy. Those streams touch recovery semantics,
DB migrations, and run state invariants.

Use GLM 5.2 for the Podman driver if it stays inside the existing SandboxDriver seam.
Have GPT 5.5 review it before merge because container execution is a security boundary.

## Setup commands

Run from `/Users/acartagena/project/ductum-next`:

```sh
git worktree add /Users/acartagena/project/dn-p2-agent-identity -b stream/p2-agent-identity phase2
git worktree add /Users/acartagena/project/dn-p2-podman-sandbox -b stream/p2-podman-sandbox phase2
git worktree add /Users/acartagena/project/dn-p2-gate-transaction -b stream/p2-gate-transaction phase2
git worktree add /Users/acartagena/project/dn-p2-lease-fencing -b stream/p2-lease-fencing phase2
```

If a worktree does not have `node_modules`, the worker should run:

```sh
pnpm install --frozen-lockfile
```

## Worker contract

- Read `AGENTS.md`, `design/README.md`, `design/ROADMAP.md`, and the stream brief.
- Stay in the assigned lane. If another stream owns a file, stop and report before
  editing it.
- Do not push.
- Commit locally with a conventional commit subject and no AI attribution.
- Report files changed, exact verification output, and any bugs or scope risks.
- Only say a check passed if you ran it and saw the passing count/output.
- Keep every non-grandfathered source/test file under 300 LOC.

## Orchestrator merge order

Merge `stream/p2-agent-identity` first if it is ready, because it closes the known
recovery failover identity gap. `stream/p2-podman-sandbox` may merge before or after
that if it stays inside the sandbox seam. Merge `stream/p2-gate-transaction` before
starting lease/fencing.

After every worker branch:

```sh
git -C /Users/acartagena/project/ductum-next status --short --branch
git -C /Users/acartagena/project/ductum-next merge --no-ff <branch> -m "merge: <short scope> (<branch>)"
pnpm build
pnpm -C packages/core exec vitest run
pnpm -C packages/api exec vitest run
node scripts/check-file-size.mjs
```

Run dashboard tests too if the branch touches `packages/dashboard/`.
