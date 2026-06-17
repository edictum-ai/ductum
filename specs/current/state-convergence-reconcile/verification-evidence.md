# Verification Evidence

Date: 2026-04-28

## Passed

- `node packages/cli/dist/index.js spec contract-check ductum specs/current/state-convergence-reconcile --path`
  - PASS
- `node packages/cli/dist/index.js spec drift-review ductum state-convergence-reconcile`
  - PASS
- `pnpm --filter @ductum/core test`
  - PASS (`40` files, `383` tests)
- `pnpm --filter @ductum/api exec vitest run src/tests/reconcile.test.ts src/tests/reconcile-audit-coverage.test.ts src/tests/reconcile-audit-failure.test.ts src/tests/reconcile-side-effects-failure.test.ts src/tests/reconcile-convergence.test.ts src/tests/reconcile-route-convergence.test.ts`
  - PASS (`6` files, `37` tests)
- `pnpm --filter @ductum/api exec vitest run src/tests/reconcile-convergence.test.ts src/tests/reconcile-route-convergence.test.ts`
  - PASS (`2` files, `5` tests)
- `pnpm --filter @ductum/cli test -- factory-ops-command commands`
  - PASS (`41` files, `323` tests)
- `pnpm build`
  - PASS
- `git diff --check`
  - PASS

## Verification Caveat

- `pnpm --filter @ductum/api test -- reconcile-convergence reconcile-route-convergence`
  - This Vitest filter string overmatched unrelated API suites in this worktree.
  - The run reached unrelated `notification-channel` failures returning
    `Operator token required`.
  - The reconcile-specific files above passed when targeted directly by path.
