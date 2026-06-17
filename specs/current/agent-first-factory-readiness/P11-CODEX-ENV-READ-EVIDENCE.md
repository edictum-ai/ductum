# P11 - Codex Env Read Evidence

## Problem

Dogfood run `mEMc0A11pPGD` read both required workflow files with a Codex
app-server shell command:

```sh
/bin/zsh -lc "pwd && echo '--- README.md ---' && sed -n '1,200p' README.md && echo '--- CLAUDE.md ---' && sed -n '1,200p' CLAUDE.md && echo '--- env task hints ---' && env | grep -E 'DUCTUM|TASK|RUN|CODEX' | sort"
```

The run stayed in `understand`. Ductum recorded the completed command as
`Bash`, not canonical `Read` evidence, because the shared shell-read classifier
treated the read-only `env | grep | sort` tail as an unknown command segment.
The next verification command was then correctly blocked as a mutating Bash
command during `understand`.

## Behavior Contract

- A read-only Codex app-server shell exploration command that reads
  `README.md` and `CLAUDE.md`, then inspects environment variables with
  `env | grep ... | sort`, must emit canonical `Read` success evidence for both
  required files so Edictum can advance out of `understand`.
- The classifier must still fail closed for mutating env usage, shell
  redirection, heredocs, interpreter write APIs, and command segments that
  execute arbitrary programs through `env`.
- Compound commands without a required workflow read target must remain `Bash`.
- API authorization for compound shell commands must stay conservative on the
  Bash command path; do not bypass command-scope checks by relabeling compound
  authorization as `Read`.
- Use the existing shared classifier. Do not add a second policy path, new
  table, or dependency.

## Decision Trace

- Decision `053`: work remains represented as Specs, Tasks, Runs, Decisions,
  and Evidence.
- Decision `054`: harness adapters normalize provider events to canonical
  Ductum events without owning policy.
- Decision `056`: sandbox and command boundaries remain structural controls.
- Decision `060`: dogfood drift must become an explicit task with evidence.
- Decision `108`: execution integrity and evidence truthfulness are
  operator-visible trust surfaces.

## Verification

```sh
pnpm --filter @ductum/core test -- shell-read-detection enforce
pnpm --filter @ductum/harness test -- codex-app-server-events canonical-events
pnpm --filter @ductum/api test -- harness-loader routes
pnpm build
pnpm test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

## Drift Handling

- Record a Ductum Decision before loosening mutation blocking or changing the
  Edictum workflow model.
- Keep `authorize_tool` harness-internal and `gate_check` read-only.
- Do not make prompt instructions responsible for enforcement.

## Slop Review

- Attack false positives that classify unsafe shell as read evidence.
- Attack tests that only check `extractWorkflowReadPath` but not completed
  Codex app-server tool-result emission.
- Attack changes that advance workflow state from tool requests instead of
  successful tool results.
- Attack any weakening of protected path or factory DB command blocking.
