# Fix dashboard approval/sidebar demo polish review findings

The review of `polish-approval-and-sidebar-demo-state` produced a WARN verdict. Fix the implementation in the existing shared worktree.

Required fixes:

1. Add focused tests for the actual reject regression:
   - failed reject keeps the row visible
   - failed reject renders the new reject failure card
   - successful reject starts/removes the row exit animation only after the mutation succeeds

2. Preserve the sidebar's visual polish while removing the fake `$80 budget` claim:
   - do not show a fake total budget or fake percentage
   - keep a small pulse/progress-style treatment so the sidebar still feels designed
   - label the metric honestly as weekly tracked spend or week spend

3. Split `packages/dashboard/src/pages/ApprovalQueue.tsx` so the touched page file is under 300 LOC.
   - Extract reusable approval queue UI/types/helpers into small files under `packages/dashboard/src/components/approval` or another existing dashboard pattern.
   - Keep every new file under 300 LOC.
   - Do not change user-facing behavior except the rejection/error behavior described above.

4. Keep the existing dashboard style. Do not add dependencies.

Verification:

```bash
pnpm --filter @ductum/dashboard exec vitest run src/tests/pages.test.tsx src/tests/sse.test.ts
pnpm --filter @ductum/dashboard build
```
