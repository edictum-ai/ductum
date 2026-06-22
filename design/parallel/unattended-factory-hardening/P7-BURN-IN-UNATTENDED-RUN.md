# P7 - Burn In Unattended Run

## Decision Trace

- Depends on P1-P6.
- D166 says Ductum may dogfood hardening stages after closeout.
- D172 says Podman agent containment is required before the unattended claim.

## Behavior Contract

- [ ] A real Qratum burn-in must run through Ductum from dispatch to final
  approval/merge/push policy without manual babysitting; evidence: live CLI/API
  output.
- [ ] Runtime must use project workflow verification for the burn-in, not
  hardcoded commands invented by the operator; evidence: workflow/profile
  output.
- [ ] Final factory state must have no active ghosts, hidden failed reviews,
  stale approvals, unclear pending decisions, or dirty worktrees; evidence:
  `ductum status`, compare output, and git status.
- [ ] FAILS if burn-in proof omits provider doctor, Podman execution proof, or
  bakeoff stats; evidence: linked artifacts/output.

## Verification

Run and report exact output:

```sh
pnpm build
pnpm -C packages/core exec vitest run
pnpm -C packages/api exec vitest run
pnpm -C packages/cli exec vitest run
node scripts/check-file-size.mjs
git diff --check
```

Live proof:

```sh
ductum status
ductum project show qratum-runtime
ductum project agent list qratum-runtime
ductum doctor
ductum spec bakeoff compare <burn-in-spec-id>
```

Use the supported local factory API/token path. Do not print tokens.

## Drift Handling

If the burn-in needs a manual decision, the run is not unattended. Capture the
decision as an approval/Needs Attention item and do not claim the final goal.

## Slop Review

- [ ] Attack runtime behavior: no active ghosts, no hidden failed reviews, no stale
  approvals, no leaked containers, no dirty worktrees.
- [ ] Attack explicit evidence: every "passed" claim has command output and counts.
- [ ] Attack runtime behavior: any manual nudge must be recorded and disqualify the
  unattended claim until fixed.

## Objective

Prove the factory is unattended-capable with a real Ductum-managed Qratum
burn-in and clean final state.

## Read first

- Outputs and commits from P1-P6.
- Qratum project workflow/factory settings.
- `AGENTS.md`
- `design/README.md`
- `decisions/172-podman-container-sandbox-driver.md`
- `decisions/173-quarantine-and-next-action.md`

## Allowed Scope

- Importing/running the burn-in spec, approving/merging/pushing only through
  workflow policy, collecting final evidence, and small fix-forward patches for
  burn-in-discovered bugs.

## Non-goals

- Do not redefine success around a smaller smoke test.
- Do not ignore failed matrix candidates to claim clean status.
- Do not push if policy/CI/verification does not permit it.

## Implementation Notes

- Start with a small Qratum task, then run the four-model matrix if it was not
  already run in P6.
- Use Ductum approval/merge/push paths only.
- The final answer must separate local test proof from live factory proof.

## Acceptance Criteria

- Ductum runs the Qratum burn-in through its own workflow.
- Auto-approval/merge/push behavior follows policy.
- Bakeoff stats are produced.
- Podman execution proof is present.
- Final `ductum status` is clean.

## Stop Conditions

- Any current Needs Attention item lacks an automated recovery path.
- Any provider doctor check required for the burn-in fails.
- Podman agent execution is not proven.
- Final status has active ghosts, hidden failed reviews, stale approvals, or
  unclear pending decisions.
