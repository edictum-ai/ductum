import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { readJson, requireString, optionalString, optionalStringArray } from '../lib/http.js'
import { closeGitHubIssue } from '../lib/github-issue-resolution.js'
import { intakeGitHubIssue } from '../lib/github-intake.js'
import { publicOutput } from '../lib/public-output.js'

export function registerIssueRoutes(app: Hono, context: ApiContext) {
  app.post('/api/issues/intake', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const result = await intakeGitHubIssue(context, {
      projectId: optionalString(body.projectId, 'projectId'),
      projectName: optionalString(body.projectName, 'projectName'),
      repositoryId: optionalString(body.repositoryId, 'repositoryId'),
      issueRef: requireString(body.issueRef, 'issueRef'),
      promptCommentUrls: optionalStringArray(body.promptCommentUrls, 'promptCommentUrls'),
    })
    return c.json(publicOutput(result), 201)
  })

  app.post('/api/issues/close', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const result = await closeGitHubIssue(context, {
      projectId: optionalString(body.projectId, 'projectId'),
      projectName: optionalString(body.projectName, 'projectName'),
      repository: optionalString(body.repository, 'repository'),
      issueRef: requireString(body.issueRef, 'issueRef'),
      runId: requireString(body.runId, 'runId'),
      ...(body.operatorAction == null ? {} : { operatorAction: optionalString(body.operatorAction, 'operatorAction') }),
    })
    return c.json(publicOutput(result), 201)
  })
}
