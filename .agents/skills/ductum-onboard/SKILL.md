---
name: ductum-onboard
description: Onboard an existing repository into the Ductum factory using the DB-backed Ductum CLI. Use when the user says "onboard this repo to Ductum", "add this project to the factory", "make this repo Ductum-ready", or asks how to create/import specs for another repo. Never use ductum.yaml.
---

# Ductum Onboard

Use the Ductum CLI and the live Factory database. Do not write `ductum.yaml`, do not inspect SQLite directly, and do not call the API with curl unless the user is explicitly debugging an API bug.

## Process

1. Confirm the target repo root:

```bash
git -C <path> rev-parse --show-toplevel
```

2. Read the repo's existing context:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `README.md`
- package/build files such as `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`
- CI files under `.github/workflows/`

3. Choose the Ductum project name.

Use the repo basename unless the user gives a name. Keep it stable; this is the Factory `Project`.

4. Register the repo through the CLI:

```bash
ductum project create <project> --repo /absolute/path/to/repo --merge-mode human
```

If the Project already exists:

```bash
ductum repository add <project> --repo /absolute/path/to/repo
```

5. Create a Ductum spec in the target repo.

Prefer:

```text
specs/current/<initiative>/
  README.md
  P0-...
  P1-...
```

Every stage file should include:

- Goal
- Scope
- Files likely touched
- Explicit non-goals
- Acceptance tests
- Verification commands
- Dependencies
- Risks / rollback notes
- Implementation prompt
- Review prompt

6. Import the spec:

```bash
ductum spec import /absolute/path/to/repo/specs/current/<initiative> --project <project>
```

If the spec is an intake YAML/example path that should pass the contract gate:

```bash
ductum spec intake <project> /absolute/path/to/spec-or-directory --import
```

7. Dispatch work only after import:

```bash
ductum status
ductum task list <spec-or-project-ref>
ductum attempt start <task-id> --agent <builder-agent> --project <project>
ductum watch <run-id>
```

Review must use a different model from the builder. Prefer Opus 4.8 reviewers for important work.

## What Not To Do

- Do not create or edit `ductum.yaml`.
- Do not print YAML blocks for the user to paste.
- Do not write `.edictum/workflow-profile.yaml` unless the repo already intentionally uses a custom WorkflowProfile and the user asked for it.
- Do not add `.ductum/` to the target repo by default; Ductum stores local factory state under the Factory data directory.
- Do not invent verification commands. Read the repo's package/CI files and put real commands in the spec.
- Do not implement production code while onboarding unless the user explicitly asks for implementation.

## Output

End with:

- project name
- repo path
- spec path created or found
- exact `ductum spec import` or `ductum spec intake` command
- exact first `ductum attempt start` command if tasks are already imported
- any missing repo context or verification gap
