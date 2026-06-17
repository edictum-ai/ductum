---
name: ductum-onboard
description: Onboard an existing application to the Ductum factory. Detects the stack (Python/Node/Go/Rust/etc), detects the existing agent context doc (CLAUDE.md, AGENTS.md, or README.md), creates .edictum/workflow-profile.yaml with correct setup+verify commands, and prints the ductum.yaml entry to add. Use when the user says "onboard X to ductum", "add ductum support to this project", or "scaffold this project for the factory".
---

# Ductum onboarding

The user has an existing application and wants to dispatch work on it through the Ductum factory. Your job is to **wire the project into Ductum without generating any new context docs** — real projects already have `CLAUDE.md`, `AGENTS.md`, `README.md`, or a mix. You detect what's there, point Ductum's workflow at it, and add one new file (`.edictum/workflow-profile.yaml`).

## What Ductum requires from a project

1. **At least one context doc the agent must read before leaving the `understand` stage.** Ductum doesn't care which file — it reads whatever you tell it via `required_files` in the workflow profile. Almost every real repo already has one or more of:
   - `CLAUDE.md` (Anthropic convention)
   - `AGENTS.md` (cross-tool convention, used by Codex/OpenCode/Cursor)
   - `.github/copilot-instructions.md` (GitHub Copilot convention)
   - `README.md` (universal)
   - `.cursorrules` / `.cursor/rules/*.md` (Cursor)
   - `GEMINI.md` (Google Gemini)
2. **Setup commands** in `.edictum/workflow-profile.yaml` — run in a fresh worktree before the agent starts. Must match how CI installs deps.
3. **Verify commands** in `.edictum/workflow-profile.yaml` — run after `ductum_complete`. Must match how CI tests the code. These gate the fix-loop.
4. **A project entry in `ductum.yaml`** — declares the repo path, which workflow profile to use, and which agents can work on it.

Nothing else. No code changes. No new files other than `.edictum/workflow-profile.yaml`.

## Your process

Run these steps in order. Never skip detection.

### 1. Confirm the target directory

Find the git repo root (`git rev-parse --show-toplevel`). Confirm with the user if ambiguous. Everything below happens relative to this root.

### 2. Detect the stack

Check for these files in order. Pick the first match:

| File | Stack | What to check next |
|---|---|---|
| `pyproject.toml` | Python | uv vs poetry vs pip; pytest vs unittest; ruff vs flake8; mypy/pyright |
| `package.json` | Node/TS | pnpm vs yarn vs npm; vitest vs jest; tsc; workspaces field for monorepo |
| `go.mod` | Go | `go test`; golangci-lint if `.golangci.yml` present |
| `Cargo.toml` | Rust | `cargo test`; `cargo clippy` |
| `pom.xml` | Java/Maven | `mvn test` |
| `build.gradle` or `build.gradle.kts` | Java/Gradle | `./gradlew test` |
| `Gemfile` | Ruby | `bundle exec rspec` or `rake test` |
| `mix.exs` | Elixir | `mix test` |
| `Package.swift` | Swift | `swift test` |

Read the actual config file(s) to get the real commands — don't guess. Example: for Python, look at `[tool.pytest.ini_options]` in `pyproject.toml` or `pytest.ini` to see how tests are actually invoked.

### 3. Detect existing context docs

**This is the critical step.** List which context docs already exist at the repo root:

```bash
for f in CLAUDE.md AGENTS.md .github/copilot-instructions.md GEMINI.md .cursorrules README.md; do
  [ -f "$f" ] && echo "FOUND: $f"
done
```

Pick a `required_files` list for the workflow profile using this priority (highest first — stop at the first match for the "primary" doc, but always include `README.md` if present):

1. `CLAUDE.md` present → primary = `CLAUDE.md`
2. Else `AGENTS.md` present → primary = `AGENTS.md`
3. Else `.github/copilot-instructions.md` present → primary = `.github/copilot-instructions.md`
4. Else `GEMINI.md` present → primary = `GEMINI.md`
5. Else `.cursorrules` present → primary = `.cursorrules`
6. Else `README.md` present → primary = `README.md`
7. Else → tell the user: "No context doc found. Ductum needs at least a README.md to force the agent through the understand stage. Please add one, then re-run onboarding."

The `required_files` list for the workflow profile becomes `[<primary>, README.md]` (de-duplicated — if the primary IS README.md, just `[README.md]`).

**Do not generate any context doc from scratch.** If the user has one, use it as-is. If they don't, tell them to write one and stop.

### 3b. Pick where to append the factory dispatch section

The "factory dispatch rules" section (added in step 4) should go into the **primary** doc so the agent definitely sees it during the understand stage. Priority:

- If `CLAUDE.md` is primary → append to `CLAUDE.md`
- If `AGENTS.md` is primary → append to `AGENTS.md`
- If `.github/copilot-instructions.md` is primary → append there (but also warn the user this file is loaded by GitHub Copilot and the factory rules will appear there; they may want to move the section)
- If any other doc is primary → append to `README.md` under a new `## Ductum factory rules` section

### 4. Check the existing context doc for the factory dispatch section

Read whichever primary context doc you found (CLAUDE.md > AGENTS.md > README.md) and look for a section that tells agents:

- Not to push the branch themselves (the factory handles merge)
- To stop making tool calls after `ductum_complete`
- To respect the workflow stages (understand → implement → ship)

If that section is **missing**, append this block to the END of the primary doc (after a blank line):

```markdown

## Ductum factory rules

When a task is dispatched to you via the Ductum factory:

- You are running inside an isolated git worktree. Make your changes on the current feature branch.
- **Do not run `git push`.** The factory's post-completion pipeline handles verify, review, and merge after you call `ductum_complete`.
- After you call `ductum_complete(result=...)`, stop making tool calls. Your session will end and the factory will take over.
- The workflow has three stages: `understand` (read context), `implement` (write code), `ship` (factory-owned). Work only in `implement` for code changes.
- Required verify command is in `.edictum/workflow-profile.yaml`. It will be run automatically — if it fails, a fix-loop task will be dispatched with the failure output.
```

If the section already exists (search for "ductum" or "factory" in the doc), leave it alone.

### 5. Write `.edictum/workflow-profile.yaml`

Create the directory if missing. Use the stack-appropriate template from `templates/`:

- `workflow-profile-python.yaml`
- `workflow-profile-node.yaml` (single package)
- `workflow-profile-node-monorepo.yaml` (pnpm workspace / yarn workspaces)
- `workflow-profile-go.yaml`
- `workflow-profile-rust.yaml`
- `workflow-profile-ruby.yaml`
- `workflow-profile-java-maven.yaml`
- `workflow-profile-java-gradle.yaml`

**Critical rules when editing the template**:

- Replace `required_files` with the list you picked in step 3.
- Replace setup commands with the exact commands this project uses (read `pyproject.toml`, `package.json`, etc to get them right).
- Replace verify commands with the exact commands CI runs. If the project has `.github/workflows/*.yml`, read it and copy the test + lint steps.
- Keep setup under ~60 seconds (use frozen-lockfile flags) or the dispatcher will time out.
- Keep verify under ~3 minutes or the post-completion pipeline stalls.

If `.edictum/workflow-profile.yaml` **already exists**, read it and compare against the template. Show the user a diff of what would change and ask before overwriting. The user may have customized it.

### 6. Add `.ductum/` to `.gitignore`

Ductum creates a `.ductum/` directory in the repo for local worktree tracking. Add this line to `.gitignore` if it's not already there. Do not overwrite the file — append the line.

### 7. Print the `ductum.yaml` entry

Output the exact YAML block the user needs to paste into their `ductum.yaml` under `projects:`. Don't write to `ductum.yaml` — it's the user's config file and they'll paste it themselves.

```yaml
  <project-slug>:
    repos:
      - path: /absolute/path/to/the/project
        name: <project-slug>
    workflow:
      profile: .edictum/workflow-profile.yaml
    agents:
      sonnet: [builder, reviewer]
      codex: [builder, reviewer]
      glm: [builder, reviewer, docs]
```

- `<project-slug>` = directory basename lowercased with hyphens
- `path:` = absolute path (from step 1)
- Agent list = mirror whatever's already in the user's `ductum.yaml`. If they have a custom agent (e.g. a Copilot SDK agent), print a comment reminding them to substitute.

### 8. Print the next-step summary

```
Scaffolded <project-slug> for Ductum:
  ✓ .edictum/workflow-profile.yaml created
  ✓ <context-doc>.md updated with factory dispatch rules
  ✓ .gitignore updated with .ductum/

To finish onboarding:

1. Paste the YAML block above under `projects:` in ductum.yaml
2. Restart the Ductum server:
     cd /Users/acartagena/project/ductum
     kill $(pgrep -f 'scripts/serve.mjs') 2>/dev/null
     nohup node scripts/serve.mjs > /tmp/ductum-serve.log 2>&1 &
3. Drop a spec into <project-path>/specs/ (or import a YAML spec)
4. Import + dispatch:
     ductum spec import specs/impl-XXX --project <project-slug>
```

## Rules you must follow

- **Never generate CLAUDE.md / AGENTS.md / README.md from scratch.** Use what the project has.
- **Never modify the user's source code.** Only write `.edictum/workflow-profile.yaml`, append to `.gitignore`, and (optionally, after detection) append one section to the primary context doc.
- **Always use absolute paths** in the printed ductum.yaml entry.
- **Never write to `ductum.yaml` directly.** Print the YAML and let the user paste.
- **Never invent commands.** Read the project's config files to get the real test/lint/build commands. Fall back to defaults only if nothing is configured.
- **Never skip the CI check.** If `.github/workflows/*.yml` exists, mine the test + lint steps from it — that's the source of truth for what "passing" means.

## Templates

Stack-specific templates live next to this SKILL.md in `templates/`. They're starting points, not finished artifacts — always edit the commands to match the project's actual tooling.
