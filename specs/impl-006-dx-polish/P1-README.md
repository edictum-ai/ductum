# P1: README + Quickstart

**Scope:** Getting-started guide for new users
**Depends on:** None

---

## Required Reading

- `STATUS.md` — current project state
- `.claude/handover.md` — architecture details
- `ductum.yaml` — config format
- `scripts/serve.mjs` — startup flow

## Tasks

### 1. Write README.md

Sections:
1. What Ductum is (2 sentences)
2. Prerequisites (Node 22+, pnpm 10+, ANTHROPIC_API_KEY)
3. Quick start (5 steps: clone → install → configure → serve → watch)
4. Configuration (ductum.yaml format with examples)
5. CLI reference (table of all commands)
6. How dispatch works (text diagram of the flow)
7. Dashboard (URL, what each page shows)
8. Development (build, test, package structure)

### 2. Verify quickstart works

Follow the quickstart steps on a clean checkout and verify each step.

## Verification

- [ ] README.md exists with all sections
- [ ] Quickstart works end-to-end
- [ ] CLI reference covers all commands
