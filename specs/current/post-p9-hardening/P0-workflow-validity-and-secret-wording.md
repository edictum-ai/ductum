# P0 — Workflow Validity Targeting And Secret Wording

Status: done/pass
Stage: post-p9-hardening P0
Source: `specs/current/post-p9-hardening/README.md` (P0 row)
Decision context: D166 closeout; this prompt is the explicit stage prompt the
README's P0 row was waiting for.

## Why now

The bootstrap self-test (`pnpm bootstrap:self-test`, also CI job
`ci.yml:bootstrap-self-test`) fails at dispatch with:

```
[dispatcher] error: ... Attempt start blocked by prerequisite checks.
Project ductum field projects.ductum.workflow (Project Workflow) is
.../.edictum/workflow-profile.yaml; blocks Blocks projects whose workflow does
not validate. Suggested action: Choose an existing Workflow in Project settings.
```

Root cause (traced, not guessed):

- `scripts/serve-seed.mjs` `buildProjectConfig` sets the seeded project's
  `workflowProfile` to the **workflow file path** (`.edictum/workflow-profile.yaml`).
- The validity check `workflowItems` (`packages/core/src/repair-readiness.ts`)
  resolves that ref through `findResource`, which matches only by record **id or
  name** — never by path. The seeded `WorkflowProfile` record is named `ductum`.
- Path ref vs name/id record identity never match → `workflowRefItem` blocker →
  the dispatcher refuses every attempt on the project.

Why a record-identity fix is safe and narrow: at runtime, the workflow is
resolved by **project name** through `loadWorkflowDefsByProjectName`
(`DUCTUM_WORKFLOW_PROFILES`) in `WorkflowDefinitionResolver.getForRun`, and the
run snapshot comes from the agent's `workflowProfileRef`. The project's
`workflowProfile` field is consumed **only** by the repair/validity check, so
setting it to the record name fixes resolution without touching the runtime
resolver or reviving `ductum.yaml` as authority.

Separately, `workflowValidationItem` is emitted untargeted, so an invalid
`WorkflowProfile` record marks **every** project ineligible, violating the P9
rule that valid projects continue when another is broken.

And the runtime literal-secret rejection reuses the migration message
"literal secrets are not migrated" — wrong consequence word at runtime, where
the point is the secret is **not stored**.

## Scope (narrow — do not exceed)

1. Seeded project must resolve its `WorkflowProfile` by **record identity**
   (the workflow record name declared for that project), not by raw path, and
   without making `ductum.yaml` authoritative again.
2. `workflow_validity` blockers must target the **project(s) that reference the
   invalid workflow**. Unrelated projects must remain dispatch-eligible.
3. Runtime literal-secret rejection message must say **"not stored"**; the
   legacy-migration path keeps **"not migrated"**.
4. Bootstrap self-test must surface diagnostics (serve log) on failure instead
   of failing opaquely.

## Non-goals

- No broad factory-runtime rewrite. Do not change
  `WorkflowDefinitionResolver` runtime loading semantics.
- No new dependencies. No storage-model change.
- Do not make `ductum.yaml` authoritative again.
- Do not reopen P9 acceptance or implement other post-P9 stages.

## Changes

1. `scripts/serve-seed.mjs` — `buildProjectConfig` resolves the project's
   `workflowProfile` to the `config.workflowProfiles` key whose `project`
   matches the project (record name), falling back to no ref when none is
   declared.
2. `packages/core/src/repair-readiness-items.ts` — `workflowValidationItem`
   accepts the referencing project and sets `target { projectId, projectName }`.
3. `packages/core/src/repair-readiness.ts` — `workflowItems` resolves each
   project's workflow record; emits `workflowRefItem` when the record is
   missing, else a **project-targeted** `workflowValidationItem` when that
   record's validity status failed. Unreferenced invalid records no longer
   globally block.
4. `packages/core/src/legacy-migration-secrets.ts` — message consequence word
   is parameterized (default `migrated`).
5. `packages/api/src/lib/literal-secrets.ts` — runtime asserts pass the
   `stored` consequence.
6. `scripts/bootstrap-self-test.mjs` — on failure, print the serve log tail.

## Acceptance

- `pnpm bootstrap:self-test` reaches dispatch, the run merges, and the
  README "Bootstrap proof" line lands.
- An invalid workflow blocks only the referencing project; a sibling project
  stays `eligible: true`.
- Runtime literal-secret rejection says "not stored"; migration says
  "not migrated".
- On self-test failure, the dispatcher/serve error is visible in stdout.

## Discovered adjacent blockers (fixed to reach the acceptance)

Validating the workflow-validity fix end-to-end through `pnpm bootstrap:self-test`
surfaced pre-existing blockers in the never-green self-test that are not
workflow-validity but gate the same acceptance. Fixed alongside, each with a test:

- **Self-test runnability** (`scripts/bootstrap*.mjs`): `gh auth status` is now
  time-bounded (it could hang indefinitely); the isolated-HOME pnpm install pins
  the real store + disables the modules-purge prompt (it blocked on stdin); the
  `task assign` / `spec approve` calls use `node packages/cli/dist/index.js`
  (the `pnpm exec ductum` bin was never linked); the self-test prints the serve
  log on failure.
- **Verify output buffer** (`packages/core/src/post-completion.ts`): `verifyWorktree`
  ran the verify command with the 1 MB `execFile` default `maxBuffer`. A real
  `pnpm test` exceeds it, so Node killed the child and a passing suite was
  reported as a verify failure. Now 64 MB.
- **Hermetic SSE demo** (`scripts/demos/sse-cancel-demo.mjs`): the mock demo's
  OpenAI agent needed provider auth to dispatch; under the verify's isolated
  HOME it had none and timed out. It now supplies a placeholder `OPENAI_API_KEY`
  (no real call is made in mock mode).

## Verification

- `pnpm lint`
- `pnpm bootstrap:self-test`
- `pnpm release:dryrun`
- `pnpm -r test`
- `node scripts/check-file-size.mjs`
- `git diff --check`

## Closeout

Closed as done/pass on 2026-06-10 during the `ductum@0.1.3` release recovery.

Release recovery and full evidence are recorded in
`decisions/168-ductum-0.1.3-release-recovery-closeout.md`.

Final local verification:

- `pnpm lint` passed.
- `pnpm build` passed.
- `pnpm bootstrap:self-test` passed directly against an isolated target repo
  and left the Ductum repo unchanged.
- `pnpm -r test` passed across core, dashboard, MCP, CLI, harness, and API.
- `pnpm test:scripts` passed.
- `node scripts/check-file-size.mjs` passed.
- `git diff --check` passed.
- `pnpm release:dryrun` passed after the post-publish dry-run gate was made
  strict for publish mode but tolerant of npm's already-published response in
  dry-run mode.
- GitHub CI run `27254144112` passed.
- GitHub Release run `27254361229` published `ductum@0.1.3`.
