import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const built = existsSync(resolve('packages/api/dist/index.js')) &&
  existsSync(resolve('packages/cli/dist/index.js'))

describe('sse cancel demo harness', () => {
  const runIfBuilt = built ? it : it.skip

  runIfBuilt('runs the live tmp-db SSE + cancel demo with mocked agents', async () => {
    const { stdout, stderr } = await execNode(['scripts/demos/sse-cancel-demo.mjs'], {
      ...process.env,
      DUCTUM_DEMO_MOCK_DELAY_MS: '2000',
      DUCTUM_DEMO_EVENTS_HEARTBEAT_MS: '200',
    })

    expect(stderr).toBe('')
    const result = JSON.parse(stdout)
    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: 'demo.sse_cancel.passed',
      data: {
        worktreePreserved: true,
      },
    })
    expect(result.data.runId).toEqual(expect.any(String))
  }, 100000)
})

function execNode(args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    // Generous bound: the demo also runs as the bootstrap self-test verify step,
    // sharing CPU with the orchestrating factory, so it can take longer there.
    execFile(process.execPath, args, { env, timeout: 90000 }, (error, stdout, stderr) => {
      if (error != null) {
        rejectPromise(new Error(`${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
        return
      }
      resolvePromise({ stdout, stderr })
    })
  })
}
