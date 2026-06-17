# P5 - Diary Cleanup (dogfood)

## Problem

30 of 32 spec directories on disk have a matching `feat:` commit but were
never imported into the Ductum factory database as Spec/Task records.
The previous workflow used Specs/Decisions as a diary alongside normal
git, not as the authoritative work register. Two abandoned drafts
(`cli-onboarding-smoke`, `execution-integrity-operator-readiness`) sit
in `approved`/`draft` with failed tasks and no terminal closure.

This is the diary problem. Until it's resolved, `ductum spec list`
lies about what the factory has shipped.

## Scope

Dispatched through Ductum. Bulk-import the 30 already-shipped specs
with provenance from git history.

## Behavior Contract

### 5.1 `bulk-import-shipped-specs`

For each of the 30 unimported spec directories under
`specs/current/`:

- Parse the README.md and any P*.md files into a Spec + Tasks record.
- Find the matching `feat:` / `fix:` commit(s) in git history (already
  identified during the 2026-04-30 audit; full list is captured as
  evidence on this task).
- Create one `Run` record per task with:
  - `commitSha` = the matching commit's SHA
  - `branch` = derived from the commit's branch (or `main` if direct)
  - `terminalState` = null (because the work succeeded)
  - `stage` = `done`
  - `agentId` = author of the commit (from `git log --format='%an'`)
- Mark each Spec `status = 'done'`.
- Record an evidence row of type `custom` with kind
  `bulk-import-shipped-spec`, including the original spec dir path,
  the linked commits, and the import timestamp.
- Record a Decision under `decisions/` summarizing the import.

### 5.2 `mark-abandoned-specs-failed`

After Stage 0.4 ships `SpecStatus = 'failed'`:

- `cli-onboarding-smoke` → `failed` with reason "abandoned 2026-04-30
  audit; both tasks failed without recovery path".
- `execution-integrity-operator-readiness` → `failed` with reason
  "draft was explicitly aborted 2026-04-29 by operator; no recovery".

## Verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
node packages/cli/dist/index.js spec list ductum --json
node packages/cli/dist/index.js integrity --json
```

## Exit Demo

```sh
# Number of spec dirs on disk == number in Ductum DB
ls -1 specs/current/ | grep -v '\.yaml$\|\.md$' | wc -l
node packages/cli/dist/index.js spec list ductum --json | jq '.[] | .name' | wc -l
```

These two numbers match.

`integrity --json` reports zero issues, all imported runs in `recorded`
or `external` mode (because we didn't actually re-run them).

## Slop Review

- Attack any imported spec that doesn't link to a real commit.
- Attack any imported run that gets `terminalState = 'done'` instead of
  the correct `stage = 'done', terminalState = null`.
- Attack importing a spec twice. Idempotency required.
- Attack importing in `orchestrated` mode rather than `recorded` —
  these runs were not Ductum-orchestrated.
