# FINDINGS

**Supply-chain (1–9) — green**
1. `files: ["dist","assets","README.md","LICENSE"]` — explicit and minimal. ✓
2. All deps in `packages/ductum/package.json` are exact-pinned; gate 5 enforces this and now also enforces parity with the workspace runtime packages. ✓
3. `pre-publish-gate.mjs` runs `pnpm install --frozen-lockfile`. ✓
4. Published manifest has no `scripts`. ⚠ but `better-sqlite3@11.10.0` is a direct runtime dep of the published package, so consumer install **will** run its native install script. That is documented in D155 + the package README, but consumers using `--ignore-scripts` will get a non-functional `ductum start`. Flagging as a known consequence, not a defect.
5. No hardcoded secrets in the diff. The expired token blob in `specs/backlog/next-session-inventory.md` is replaced with a generic note. ✓
6. Gate 4 extracts the tarball and scans for `.env`/`.npmrc`/`.git`/`node_modules`/credentials/token-shaped strings; evidence shows clean. ✓
7. Bin: `dist/bin/ductum.js` ESM with `#!/usr/bin/env node`; package `"type": "module"`, `engines.node >=22`. npm's Windows shim handles cross-platform. ✓
8. `isExcludedRuntimeFile` strips `.ts`, `.d.ts`, `.test.js`, `.map` from `dist/`. Verdaccio + `npm install -g <tarball>` round-trips proven. ✓
9. `publishConfig.provenance: true` + `--provenance` in `release.mjs` + `pre-publish-gate` runs `npm publish --dry-run --provenance --access public` as gate 6. ✓

**Hardening (10–12) — green**
10. Token-detect helper is gated by both loopback host **and** `DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT=1`; `ductum serve/start` only sets the env var when `--allow-token-detect` is passed, plus a stderr warning in human mode. Welcome handoff no longer touches this route. ✓
11. `serve.ts` defaults to `127.0.0.1`; non-loopback throws unless `--allow-public-host`. ✓
12. `resolveOperatorToken` only reads (`--operator-token`, env, `~/.ductum/operator-token`); never writes. D156 makes this contract explicit; serve test verifies `.env.local` is untouched. ✓

**Behavior (P4 contract + D135)**
- Package shape: name=`ductum`, version=`0.1.0`, MIT, `engines.node >=22`, `bin.ductum`, provenance — all match §4.1. ✓
- Tarball contents (§4.2) match `dist/`, `assets/specs/examples/hello-readme/`, `README.md`, `LICENSE`; source/tests/maps excluded. ✓
- Release script (§4.3): `release:dryrun` and `release:publish` exist; `release:publish` enforces clean tree, main branch, NPM_TOKEN, full test+build, ≤30 MB. ✓
- D135 gap closed: `--version` envelope (`cli.version`), `doctor` payload now includes `version`. ✓
- Pre-P4 gaps (a) sample-spec asset bundling, (b) `ductum serve/start` resolving published runtime layout, (c) operator-token-detect hardening — all addressed.

**Minor / WARN-level**
- `scripts/pre-publish-gate.mjs` is 214 LOC vs the contract's "release script ≤200 LOC" guidance. The repo's enforced size gate scans `packages/**`, so this isn't blocked, but it nudges the budget.
- `release.mjs` sets `NODE_AUTH_TOKEN` from `NPM_TOKEN` but does not write an `.npmrc` referencing it. If the operator's npm session isn't already authenticated (`npm whoami` empty) and there is no `~/.npmrc`/registry-scoped `_authToken` line, `npm publish` will fail. Worth a one-line README/doc note for the operator runbook.
- D135 envelope shape inconsistency: the bare `--version` text path prints raw `0.1.0\n`, but the `--json` path uses the full envelope (`schemaVersion`, `kind`, `data`, `ts`). Fine per spec, just noting that the human-mode line is intentionally bare.
- `agentsConfig` builder in `init/steps/api-process.ts` hard-codes 3 harness names by string compare; safe but brittle if a fourth provider is added.

# VERDICT

**PASS** (with two WARNs: pre-publish-gate.mjs LOC budget, and the implicit npm auth assumption in `release.mjs`).

The only irreversible step (`npm publish`) is correctly gated behind: clean tree, main branch, present `NPM_TOKEN`, full pnpm install+build+test, internal-import leak check, dependency parity, secret-content/path scan of the actual tarball, ≤30 MB size, and `npm publish --dry-run --provenance`. Verdaccio and direct global-install smoke against the gate's tarball both reached `init.completed`. Safe to proceed to operator-driven `pnpm release:publish` with a fresh token.

# SUGGESTED CMDS

```sh
# Optional pre-publish polish (non-blocking):
# 1) Trim pre-publish-gate.mjs back under 200 LOC, or extract its
#    walk()/run()/secret-pattern helpers into scripts/lib/.
# 2) Add a one-line note in packages/ductum/README.md (or the operator
#    runbook) about needing `npm login` or an .npmrc with
#    //registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}, since
#    release.mjs only sets NODE_AUTH_TOKEN.

# Re-run the gate just before the real publish (operator shell, fresh token):
pnpm pre-publish-gate
NPM_TOKEN=<fresh> pnpm release:dryrun
NPM_TOKEN=<fresh> pnpm release:publish

# Independent post-publish verification on a clean machine:
npm install -g ductum
ductum --json --version
ductum --json init --no-git --no-login --no-browser
```
