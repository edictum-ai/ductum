# P6 - Bootstrap Proof (dogfood)

## Problem

After Stages 0-5, the factory technically works. But "works" is operator
testimony, not a demoable claim. A new user from outside this session
can not currently clone the repo and reach a green factory without
guidance.

The exit criterion of the recovery plan must be a single command that
proves the factory is real.

## Scope

Dispatched through Ductum. One task that delivers a `pnpm bootstrap`
command, plus the demo that runs it on a clean machine.

## Behavior Contract

### 6.1 `ductum-bootstrap`

`pnpm bootstrap` (or `node scripts/bootstrap.mjs`):

1. Verifies prerequisites: Node 22+, pnpm 10+, `ANTHROPIC_API_KEY`.
   If any are missing, prints a one-line install instruction per
   missing item and exits.
2. Runs `pnpm install --frozen-lockfile` and `pnpm build`.
3. Generates a real operator token, writes it to
   `~/.ductum/operator-token` (mode 0600) and `.env.local`. The
   dashboard's auto-detect button (P0.1) reads from one of these.
4. Seeds the factory and project from `ductum.yaml`.
5. Imports a sample 1-task spec from `specs/examples/hello-readme/`
   (a new spec we add as part of this task: append a single line to
   `README.md`, verify the diff).
6. Starts `pnpm serve` if not running.
7. Walks the operator: prints the dashboard URL, the approval URL,
   the next 3 commands to try.
8. Watches dispatch progress in the terminal until the run reaches
   approval, then exits cleanly with instructions.
9. The operator clicks approve in the dashboard; the merge lands.
10. `git log -1` shows the merged commit.

The whole flow completes in under 10 minutes on a machine with
`ANTHROPIC_API_KEY` in env.

### 6.2 `bootstrap-self-test`

A CI workflow runs `pnpm bootstrap` in a clean container with mocked
agent calls that produce deterministic completions. Test fails if the
flow takes longer than 10 minutes or requires manual operator action
beyond the single approve click.

## Verification

```sh
git clone https://github.com/edictum-ai/ductum /tmp/ductum-fresh
cd /tmp/ductum-fresh
export ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
pnpm bootstrap
# At the prompt, click approve in the dashboard
git log -1
```

## Exit Demo

I personally rm -rf the repo, clone fresh, run `pnpm bootstrap`, click
one approve button in the dashboard, and end with one merged commit
and a fully green factory. Total time under 10 minutes, no other
operator action.

This is the only definition of "the factory is ready" the recovery
plan accepts.

## Slop Review

- Attack a bootstrap that asks the operator more than once for input.
- Attack a bootstrap that prints "next steps" without actually
  triggering them.
- Attack a self-test that mocks the dispatcher away — the dispatcher
  must run; only the agent calls can be mocked.
- Attack a 10-minute claim without a wall-clock measurement in the
  exit demo evidence.
