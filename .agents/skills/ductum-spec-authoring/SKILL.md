---
name: ductum-spec-authoring
description: Create Ductum-importable Markdown spec packages. Use when Codex needs to turn backlog, review notes, planning docs, dispatch prompts, or implementation plans into Ductum specs with README execution-order tables and P*.md task prompts; when preparing work for ductum spec import; or when checking whether a spec package is ready to dispatch. Never use YAML.
---

# Ductum Spec Authoring

Create Markdown spec packages that Ductum can import cleanly and operators can
dispatch without re-interpreting the plan.

Do not create YAML. Do not dispatch attempts while authoring specs unless the
user explicitly asks.

## Workflow

1. Read the repo instructions first: `AGENTS.md`, active spec/backlog docs, and
   any review files named by the user.
2. Identify the source-of-truth decision docs. If their status is not accepted,
   make that a stop condition in the generated prompts.
3. Split work into small P-files with concrete acceptance criteria and verify
   commands. Do not hide product decisions inside implementation prompts.
4. Create one spec directory containing `README.md` plus one `P*.md` file per
   task.
5. Run `git diff --check` for touched repos and list created files.
6. Report exact `ductum spec import` commands, but do not run them unless the
   user asks.

## Directory Shape

Use this layout:

```text
path/to/spec-package/
├── README.md
├── P1-SHORT-NAME.md
├── P2-SHORT-NAME.md
└── P3-SHORT-NAME.md
```

`README.md` must include both the contract sections and an execution order
table Ductum can parse:

```markdown
## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|--------|---------|-------|-------------|--------|------------|
| 1 | [P1-SHORT-NAME.md](P1-SHORT-NAME.md) | package | scope | deliverable | [ ] | - |
| 2 | [P2-SHORT-NAME.md](P2-SHORT-NAME.md) | package | scope | deliverable | [ ] | P1 |
```

Rules:

- Link every prompt file from the `Prompt` column.
- Use `P1`, `P2`, etc. in `Depends On`; Ductum resolves those to task names.
- Use `-`, `--`, or an empty cell for no dependencies.
- Keep parked/future work in a separate directory marked not-yet-importable.

## Prompt Shape

The spec `README.md` and every `P*.md` must contain these Ductum contract
sections:

- Decision Trace
- Behavior Contract
- Verification
- Drift Handling
- Slop Review

Every `P*.md` must also contain the implementation work shape:

- Objective
- Read first
- Allowed scope
- Non-goals
- Implementation notes
- Acceptance criteria
- Stop conditions
- Residual pinning

Write prompts as commands to the implementer, not as vague project notes.
Include absolute paths when the work spans repositories.

### Residual pinning

A stage may close with residuals only when each residual is pinned. Acceptance
criteria must say so. Each residual needs at least one of:

- a **fix** — name the file, test, or command that resolves it in this change;
- a **test pinning current behavior** — name the test file and the behavior it
  pins, so future changes must keep or update it on purpose; or
- a **decision reference** — name the `decisions/<NNN>-*.md` document that owns
  the follow-up.

Prose-only acknowledgment is not a pin. If a residual cannot be fixed or tested
in scope, the prompt must escalate it to a decision before the stage closes.
See `decisions/185-residuals-pinned-before-close.md`.

## Contract Gate

Keep the contract sections lean, but write them so Ductum's import gate can see
real behavior.

Behavior Contract:

- Use checklist bullets.
- Prefer 2-4 bullets.
- Each bullet should name a behavior plus a failure mode, runtime requirement,
  or evidence path.
- Good shape: `- [ ] FAILS if <behavior>; evidence: <test/command/artifact>.`
- Good shape: `- [ ] Runtime must reject <invalid input> with an operator-visible
  error; evidence: <test>.`
- Good shape: `- [ ] REJECTS unauthorized <action>; evidence: <test command>.`
- Keep the failure signal and behavior subject in the bullet itself. Normal
  wrapped continuation lines are okay, but do not bury the only concrete signal
  in a later prose paragraph.
- Use concrete evidence paths such as `pnpm test`, `make verify`, `git diff
  docs/contracts.md`, a migration filename, golden tests, or a named artifact.
  Generic `behavioral tests` is weaker than a real command/path.
- Avoid generic non-goal-only bullets such as `No new dependencies`; attach
  the failure/evidence path if it matters.
- If `ductum spec import` reports a weak Behavior Contract, revise the prompt
  using the per-bullet warning. Do not use `--waive-contract` unless the
  operator explicitly accepts that process gap.

Slop Review:

- Use checklist bullets, not only a prose paragraph or blockquote.
- Include at least two bullets that ask the reviewer to attack behavior, for
  example: `explicit evidence`, `loud failure`, `missing or invalid inputs`,
  `duplicate`, `routing logic`, `behavior contract`, or `behavioral tests`.
- A prose reviewer prompt can follow under `Reviewer guidance:`, but the
  checklist is the contract gate surface.

Minimal is fine. Empty ceremony is not. Do not add undecided product claims just
to satisfy the gate.

Minimal compliant example:

```markdown
## Behavior Contract

- [ ] Runtime must reject missing required input with an operator-visible error;
  evidence: `pnpm test`.
- [ ] FAILS if approval is bypassed or silently swallowed; evidence:
  `pnpm test -- approval`.
- [ ] REJECTS unauthorized scope/namespace access; evidence:
  `docs/contracts.md` diff + auth tests.

## Slop Review

- [ ] Attack missing or invalid inputs: are they loud failures?
- [ ] Attack duplicate/routing logic: is there explicit evidence?
- [ ] Attack the Behavior Contract: every item has test output or artifact
  evidence.
```

## Gates

Add stop conditions when any of these apply:

- Source docs are not marked `Accepted`.
- Required spec/review inputs are uncommitted.
- The target worktree is dirty in a way that affects the task.
- Verification commands are unknown.
- A security/auth/data-model decision is unresolved.
- The task depends on external deployment, archived exports, credentials, or
  manual operator steps.

If verification is unknown, write `VERIFY GAP:` with the exact command or
decision that must be confirmed before dispatch.

## Scope Rules

- Preserve existing user changes. Do not clean or revert unrelated work.
- Keep docs-only prompts docs-only.
- Mark operator-only steps explicitly, especially global hook installs, exports,
  credential issuance, production deploys, and one-shot push/import runs.
- Keep unrelated product/repo work out of the spec unless the user explicitly
  asks to include it.
- Do not add dependencies in implementation prompts unless the prompt includes
  the supply-chain approval path and exact version policy.

## Agent Routing Notes

Use the `ductum-cli` skill for live factory commands. For spec prompts, include
operator routing guidance only when useful:

- Normal work: use the project's default builder.
- Cheap comparison: include at least one lower-cost assigned builder when the
  project has one.
- Frontend/UI work: prefer the strongest assigned frontend-capable builder.
- Best-of-N: use 2-5 assigned builders and a reviewer whose model differs from
  every builder model.
- When model-specific names matter, read Factory Settings instead of hardcoding
  local aliases.

## Report Format

End with:

- files created or changed
- unresolved `VERIFY GAP`s
- stop conditions still blocking dispatch
- exact import commands
- whether Ductum import was run

Example import command:

```bash
pnpm --dir /path/to/ductum ductum spec import \
  /absolute/path/to/spec-package \
  --project <project-name> --api-url <ductum-api-url>
```
