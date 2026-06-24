#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_DIR = resolve(ROOT, 'packages/ductum')
const TRUSTED_REPOSITORY = 'edictum-ai/ductum'
const TRUSTED_WORKFLOW_PATH = '.github/workflows/release.yml'
const SEMVER_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function buildReleasePlan({ mode, env = process.env, packageVersion }) {
  if (!['dryrun', 'publish'].includes(mode)) {
    throw new Error('Usage: node scripts/release.mjs <dryrun|publish|check-tag>')
  }

  const commands = [
    {
      command: 'node',
      args: ['scripts/pre-publish-gate.mjs', mode],
      cwd: ROOT,
      ...(mode === 'publish' ? { stdio: 'inherit' } : {}),
    },
    {
      command: 'node',
      args: ['scripts/build-homebrew-artifact.mjs'],
      cwd: ROOT,
      ...(mode === 'publish' ? { stdio: 'inherit' } : {}),
    },
  ]
  if (mode === 'dryrun') return { publish: false, commands }

  assertTrustedPublishingContext({ env, packageVersion })
  commands.push({
    command: 'npm',
    args: publishArgs(env),
    cwd: PACKAGE_DIR,
    stdio: 'inherit',
  })
  return { publish: true, commands }
}

export function publishArgs(env = process.env) {
  return shouldPublishWithProvenance(env)
    ? ['publish', '--provenance', '--access', 'public']
    : ['publish', '--access', 'public']
}

function shouldPublishWithProvenance(env) {
  const raw = env.DUCTUM_RELEASE_PROVENANCE
  if (raw == null || String(raw).trim() === '') return true
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase())
}

export function assertTrustedPublishingContext({ env, packageVersion }) {
  if (env.GITHUB_ACTIONS !== 'true') {
    throw new Error('Refusing to publish outside GitHub Actions.')
  }
  if (hasValue(env.NPM_TOKEN) || hasValue(env.NODE_AUTH_TOKEN)) {
    throw new Error('Refusing to publish with npm token environment variables present.')
  }
  if (!hasValue(env.ACTIONS_ID_TOKEN_REQUEST_URL) || !hasValue(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)) {
    throw new Error('Refusing to publish without GitHub Actions OIDC token request environment.')
  }
  if (env.GITHUB_REPOSITORY !== TRUSTED_REPOSITORY) {
    throw new Error(`Refusing to publish from repository ${env.GITHUB_REPOSITORY ?? '<unset>'}.`)
  }
  const expectedWorkflowPrefix = `${TRUSTED_REPOSITORY}/${TRUSTED_WORKFLOW_PATH}@`
  if (!String(env.GITHUB_WORKFLOW_REF ?? '').startsWith(expectedWorkflowPrefix)) {
    throw new Error('Refusing to publish outside .github/workflows/release.yml.')
  }

  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    assertManualDispatchRef(env)
    return
  }
  if (env.GITHUB_EVENT_NAME === 'push') {
    assertTagReleaseRef(env, packageVersion)
    return
  }
  throw new Error(`Refusing to publish from GitHub event ${env.GITHUB_EVENT_NAME ?? '<unset>'}.`)
}

export function assertTagMatchesPackageVersion(tag, packageVersion) {
  if (!SEMVER_TAG.test(tag)) throw new Error(`Release tag is not semver: ${tag}`)
  const tagVersion = tag.slice(1)
  if (tagVersion !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match packages/ductum version ${packageVersion}.`)
  }
}

export function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(resolve(PACKAGE_DIR, 'package.json'), 'utf8'))
  return pkg.version
}

function assertManualDispatchRef(env) {
  if (env.GITHUB_REF_TYPE !== 'branch' || env.GITHUB_REF_NAME !== 'main') {
    throw new Error('Refusing workflow_dispatch publish outside main.')
  }
}

function assertTagReleaseRef(env, packageVersion) {
  if (env.GITHUB_REF_TYPE !== 'tag') {
    throw new Error('Refusing push publish outside a git tag.')
  }
  assertTagMatchesPackageVersion(String(env.GITHUB_REF_NAME ?? ''), packageVersion)
}

function hasValue(value) {
  return value != null && String(value).trim() !== ''
}

function main() {
  const mode = process.argv[2] ?? 'dryrun'
  if (mode === 'check-tag') {
    try {
      assertTagReleaseRef(process.env, readPackageVersion())
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    return
  }
  let plan
  try {
    plan = buildReleasePlan({ mode, packageVersion: readPackageVersion() })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  for (const command of plan.commands) {
    run(command.command, command.args, command.cwd, { stdio: command.stdio })
  }
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: options.stdio === 'inherit' ? undefined : 'utf8',
    shell: false,
    stdio: options.stdio,
  })
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    if (output !== '') console.error(output)
    process.exit(result.status ?? 1)
  }
  return result
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main()
