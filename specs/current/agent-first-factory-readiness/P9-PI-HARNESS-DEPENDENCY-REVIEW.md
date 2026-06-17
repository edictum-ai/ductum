Decision Trace: 052, 054, 058, 080, 108.

## Behavior Contract

- Do not add, install, or import a Pi package in this task.
- Verify the current Pi package surface from npm and upstream metadata, then write a dependency review artifact under `docs/`.
- The review must say whether Pi is safe to consider for a later adapter spike under Ductum's exact-pin and scripts-disabled supply-chain rules.
- The review must list transitive risk areas that matter for Ductum: model/provider SDKs, postinstall/native behavior, broad semver ranges, git/tarball deps, license, CLI/runtime shape, and whether Pi exposes a stable library API or only a CLI.
- The review must keep Pi blocked unless a normal Ductum config path can select it, the harness registry can export it, and tests can run without violating supply-chain policy.
- Do not turn Pi into the default harness and do not replace working Claude/Codex/Codex-app-server paths.

## Verification

- Run `npm view @mariozechner/pi-coding-agent version license repository dependencies dist.integrity --json`.
- Run `npm view @mariozechner/pi-agent-core version license repository dependencies dist.integrity --json`.
- Run `npm view @mariozechner/pi-ai version license repository dependencies dist.integrity --json`.
- Run `git diff --check`.
- Run `node packages/cli/dist/index.js operator brief --json`.
- Run `node packages/cli/dist/index.js integrity --json`.

## Drift Handling

- Record a Ductum Decision before adding any Pi dependency or changing harness runtime behavior.
- Do not add a provider marketplace or generic plugin system.
- Keep Edictum as the policy boundary; Pi may only become a harness adapter later.

## Slop Review

- Attack any claim that Pi is implemented.
- Attack any dependency recommendation that ignores exact pins, scripts-disabled installs, or broad transitive provider SDK scope.
- Attack vague "looks fine" language. The review must name concrete package metadata and concrete next blockers.
- Attack any hidden assumption that npm metadata from a previous day is still current.

Task: Produce a current Pi harness dependency review artifact that verifies npm/upstream metadata and clearly states the next safe step. This is a preflight only; no dependency or adapter code should be added.
