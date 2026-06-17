# P5: ApprovalQueue + Test Suite

**Scope:** Rewrite ApprovalQueue, update all dashboard tests for shadcn
**Package:** `packages/dashboard`
**Depends on:** P3 (RunDetail — approval actions)
**Deliverable:** Approval queue works, all tests pass

---

## Required Reading

- `src/pages/ApprovalQueue.tsx` (current — 120 lines)
- `src/tests/` — all test files
- `src/tests/test-utils.tsx` — test wrapper (remove MantineProvider)

## Tasks

### 1. Rewrite ApprovalQueue

Straight port of the existing approval queue to shadcn — same functionality.
Uses GET /api/runs?stage=waiting-for-approval endpoint.
Each card shows: task ID, agent ID, PR link, CI/review status badges.
Approve/Reject buttons inline.
Error state when API unavailable (not silent empty).

Do NOT add enriched context (task names, test summaries, completion text) — that's impl-005/P4.

### 2. Update test utilities

Remove MantineProvider from test wrapper.
Update `renderWithProviders` in test-utils.tsx.

### 3. Update all tests

Update tests to match shadcn rendering:
- run-detail.test.tsx — check for new element structure
- pages.test.tsx — update text matchers
- sse.test.ts — unchanged (no DOM)

### 4. Remove stale JS test files

Delete any `.test.js` files that are compiled copies of `.test.tsx` files.

## Verification

- [ ] `pnpm --filter @ductum/dashboard build` passes
- [ ] `pnpm --filter @ductum/dashboard test` — all tests pass
- [ ] ApprovalQueue shows error state when API unavailable
- [ ] ApprovalQueue shows approval cards with full context when approvals exist
- [ ] No stale .test.js files remain
