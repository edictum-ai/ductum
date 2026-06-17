# Supply Chain Security — Ductum

Hardened in response to the March 2026 supply chain campaign.

## Threat landscape (March 2026)

Two major supply chain attacks hit the npm/PyPI ecosystems within one week:

**LiteLLM (PyPI, March 24):** TeamPCP stole PyPI credentials via a poisoned Trivy GitHub Action in LiteLLM's CI. Compromised versions 1.82.7 and 1.82.8 included a `.pth` file that executes a credential stealer on every Python process startup. ~40 min exposure, ~480M total downloads.

**Axios (npm, March 31):** North Korean group UNC1069 compromised the axios maintainer's npm account. Published versions 1.14.1 and 0.30.4 with a pre-staged malicious dependency (`plain-crypto-js`) that drops a cross-platform RAT. ~3 hour exposure, ~70M weekly downloads.

Both attacks exploited: floating version ranges, postinstall script execution, and tag-based GitHub Action references.

## Protections in place

### 1. Exact version pinning (`save-exact=true`)

No `^` or `~` ranges. Every dependency is pinned to an exact version in `package.json`. This prevents `pnpm install` from silently pulling a compromised patch release.

Configured in: `.npmrc`

### 2. Frozen lockfile in CI (`--frozen-lockfile`)

CI fails if `pnpm-lock.yaml` is missing or doesn't match `package.json`. No lockfile rewrites in CI. This ensures the exact resolved dependency tree is reproducible.

Configured in: `.npmrc`, `.github/workflows/ci.yml`

### 3. Postinstall scripts disabled (`ignore-scripts=true`)

Postinstall hooks are the primary execution vector for npm supply chain attacks. The axios attack used `plain-crypto-js`'s postinstall to download and execute a RAT. Scripts are disabled globally; only explicitly trusted native packages (better-sqlite3, esbuild) are rebuilt.

Configured in: `.npmrc`, `pnpm-workspace.yaml` (`onlyBuiltDependencies`)

### 4. SHA-pinned GitHub Actions

Tag-based references (`@v4`) can be silently repointed. TeamPCP compromised Trivy and Checkmarx Actions this way. All GitHub Actions in our CI use full commit SHA pins.

Configured in: `.github/workflows/ci.yml`

### 5. Dependency audit in CI

`pnpm audit --audit-level=high` runs on every PR. Catches known vulnerabilities before they reach main.

Configured in: `.github/workflows/ci.yml`

### 6. No hoisting (`hoist=false`)

Prevents phantom dependency exploitation where a package accidentally resolves a transitive dependency it didn't declare.

Configured in: `.npmrc`

## What to do when adding dependencies

1. **Pin exact version:** `pnpm add some-package` (save-exact handles this)
2. **If it needs postinstall:** Add to `onlyBuiltDependencies` in `pnpm-workspace.yaml`
3. **Commit lockfile:** Always commit `pnpm-lock.yaml` changes
4. **Check provenance:** Prefer packages with npm provenance signatures
5. **Review before merge:** Look at what changed in the lockfile diff

## What to do if a dependency is compromised

1. **Don't panic.** Check the exposure window and whether your lockfile has the affected version.
2. **Check lockfile:** `pnpm why <package>` to see if the compromised version is resolved
3. **If affected:** Pin to the last known-good version, run `pnpm install`, commit lockfile
4. **Rebuild:** `pnpm rebuild` only the trusted native packages
5. **Rotate credentials:** If the malware was a credential stealer (like TeamPCP), rotate all secrets that were accessible to the CI/dev environment
