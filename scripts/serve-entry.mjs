#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

await run()

async function run() {
  process.chdir(ROOT)
  if (process.env.DUCTUM_SKIP_BUILD !== '1') {
    await runCommand('pnpm', ['build'])
  }
  await runCommand('node', ['scripts/serve.mjs', ...process.argv.slice(2)])
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}
