import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { evaluateTaskDAGAndKick } from '../lib/dispatch-kick.js'
import { recordExternalTaskOutcome } from '../lib/record-external-task-outcome.js'
import { recordImportedTaskRun } from '../lib/record-imported-task-run.js'
import {
  optionalRecord,
  optionalString,
  readJson,
  requireArray,
  requireString,
} from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'

export function registerTaskImportRoutes(app: Hono, context: ApiContext) {
  app.post('/api/tasks/:id/external-outcome', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const result = recordExternalTaskOutcome(context, c.req.param('id') as never, {
      outcome: requireString(body.outcome, 'outcome'),
      reason: requireString(body.reason, 'reason'),
      author: optionalString(body.author, 'author') ?? null,
      branch: optionalString(body.branch, 'branch') ?? null,
      commitSha: optionalString(body.commitSha, 'commitSha') ?? null,
      sourcePath: optionalString(body.sourcePath, 'sourcePath') ?? null,
      recordedAt: optionalString(body.recordedAt, 'recordedAt') ?? null,
    })
    await evaluateTaskDAGAndKick(
      context,
      result.task.specId,
      `external task outcome recorded for ${result.task.id}`,
      [result.task.id],
    )
    return c.json(publicOutput(result), result.alreadyRecorded ? 200 : 201)
  })

  app.post('/api/tasks/:id/recorded-run', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const linkedCommits = parseLinkedCommits(body.linkedCommits)
    const result = recordImportedTaskRun(context, c.req.param('id') as never, {
      author: requireString(body.author, 'author'),
      branch: optionalString(body.branch, 'branch') ?? 'main',
      commitSha: requireString(body.commitSha, 'commitSha'),
      sourcePath: requireString(body.sourcePath, 'sourcePath'),
      taskFilePath: optionalString(body.taskFilePath, 'taskFilePath') ?? null,
      subject: optionalString(body.subject, 'subject') ?? null,
      importedAt: optionalString(body.importedAt, 'importedAt') ?? null,
      linkedCommits,
    })
    return c.json(publicOutput(result), result.alreadyRecorded ? 200 : 201)
  })
}

function parseLinkedCommits(value: unknown) {
  if (value === undefined) return []
  return requireArray(value, 'linkedCommits').map((item, index) => {
    const row = optionalRecord(item, `linkedCommits[${index}]`) ?? {}
    return {
      sha: requireString(row.sha, `linkedCommits[${index}].sha`),
      author: requireString(row.author, `linkedCommits[${index}].author`),
      subject: requireString(row.subject, `linkedCommits[${index}].subject`),
      branch: optionalString(row.branch, `linkedCommits[${index}].branch`) ?? 'main',
      taskName: optionalString(row.taskName, `linkedCommits[${index}].taskName`),
      path: optionalString(row.path, `linkedCommits[${index}].path`),
    }
  })
}
