# P4: Approval Queue v2

**Scope:** One-glance approval decisions with full context
**Package:** `packages/dashboard`
**Depends on:** P2 (reuses failure/completion summary components)

---

## Tasks

### 1. Enrich approval cards

Each card shows:
- Task name + project/spec breadcrumb
- Agent name + model
- PR link + branch
- CI status badge + review status badge
- Changed files count (if available from evidence)
- Test summary: "30 tests, all pass" (from test evidence)
- Agent's completion summary (first 200 chars with expand)
- Approve / Reject buttons

### 2. Inline actions

Approve and reject should work without page navigation.
Show confirmation on reject (reason input).
After action, card animates out and query invalidates.

## Verification

- [ ] Approval cards show full context without opening run
- [ ] Can approve/reject from the queue
- [ ] Shows test evidence inline
- [ ] Shows agent completion summary
