# D168: Ductum 0.1.3 release recovery closeout

Date: 2026-06-10

## Status

Accepted.

## Context

The first trusted-publishing release path failed after the `v0.1.2` tag was
created. That tag remains remote history and was not reused or force-moved.

The recovery bumped `packages/ductum/package.json` to `0.1.3` and pushed a
`v0.1.3` tag, but that tag workflow also failed before the final recovery fix
because the release workflow tried to attach npm provenance from a private
GitHub repository. npm trusted publishing through GitHub OIDC worked; the
rejected part was the provenance bundle.

Separately, the bootstrap self-test could mutate the Ductum repository and
then fail on repeat runs because the README proof line already existed. That
made release verification non-hermetic and left the onboarding path too easy
to regress after P9.

## Decision

`ductum@0.1.3` is the accepted recovery release.

The package was published through GitHub trusted publishing from the private
repository without an npm token. The release used manual workflow dispatch from
`main` after the `v0.1.3` tag event had already failed; the existing tag was
not force-moved or reused.

Private-repository releases now publish without npm provenance because npm
rejects provenance bundles whose GitHub source repository is private. Public
repository releases still request provenance.

The bootstrap self-test now runs against an isolated target repository and
temporary config/database. It still exercises the real bootstrap, dispatch,
approval, and merge path, but it no longer commits proof-line changes into the
Ductum source repository.

Post-publish dry runs are allowed to tolerate npm's duplicate-version dry-run
response only in `release:dryrun` mode. `release:publish` remains strict and
still fails before publish when the current version is already published.

## Evidence

Published package:

- `npm view ductum versions --json` lists `0.1.3`.
- GitHub Release workflow run `27254361229` completed successfully from
  `workflow_dispatch` on `main`.
- GitHub CI run `27254144112` completed successfully for
  `02ebacc fix: stabilize release recovery gates`.

Local non-regression gates run on 2026-06-10:

- `pnpm lint` passed.
- `pnpm build` passed.
- `pnpm bootstrap:self-test` passed directly. The run reached approval,
  approved run `mVoGe4NcOkw7`, merged the isolated target branch, and left the
  Ductum repository unchanged.
- After bootstrap self-test, `git status --short` was empty and
  `git log -3 --oneline` still started at `02ebacc`.
- `pnpm -r test` passed: core 571, dashboard 172, MCP 14, CLI 567, harness
  145, API 438.
- `pnpm test:scripts` passed: 57 script tests.
- `node scripts/check-file-size.mjs` passed: 860 files scanned, 40
  grandfathered files over 300 LOC.
- `git diff --check` passed.
- `pnpm release:dryrun` passed after the post-publish duplicate-version
  dry-run fix in `825aadc`.
- Stale process scans found no lingering Ductum serve/bootstrap/release
  process; only the scan command matched itself.

## Known Warnings

The release and CI runs reported GitHub runner warnings about Node.js 20 action
deprecation and intermittent GitHub cache restore/save warnings. These did not
fail jobs.

Local npm read-only commands report warnings for pnpm-style `.npmrc` keys that
npm does not understand. These warnings did not block publish or package
verification.

Some Vitest suites intentionally print stderr/stdout for failure-path fixtures
and React `act(...)` warnings. The suites passed.

## Consequences

`0.1.3` is already published. The next npm release must bump to a new version.

The release provenance setting is now repository-visibility-aware:

- public source repository: trusted publishing with provenance;
- private source repository: trusted publishing without provenance.

The post-P9 P0 hardening and release recovery gates are green as of this
decision. Later post-P9 stages remain governed by
`specs/current/post-p9-hardening/README.md`.
