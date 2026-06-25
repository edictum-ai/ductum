import { Command } from 'commander'

import { formatSummaryRows } from '../format.js'
import { createAction, splitCsv } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { requireProjectByName } from './common.js'

interface IssueIntakeOptions {
  repository?: string
  promptCommentUrls: string[]
}

export function registerIssueCommands(program: Command, deps: CliProgramDeps) {
  const issue = program.command('issue').description('Manage GitHub issue intake')
  issue
    .command('intake <projectName> <issueRef>')
    .option('--repository <name>', 'Repository name when the project has multiple repositories')
    .option('--prompt-comment-urls <urls>', 'Comma-separated GitHub issue comment URLs selected as prompt sources', splitCsv, [])
    .description('Import a GitHub issue work item into Ductum')
    .action(createAction(deps, async (ctx, projectName: string, issueRef: string, options: IssueIntakeOptions) => {
      const project = await requireProjectByName(ctx.api, projectName)
      const repositories = await ctx.api.listRepositories(project.id)
      const repository = options.repository == null
        ? null
        : repositories.find((candidate) => candidate.name === options.repository) ?? null
      if (options.repository != null && repository == null) {
        throw new Error(`Repository not found in project ${projectName}: ${options.repository}`)
      }

      const promptCommentUrls = options.promptCommentUrls ?? []
      const result = await ctx.api.intakeGitHubIssue({
        projectId: project.id,
        repositoryId: repository?.id,
        issueRef,
        ...(promptCommentUrls.length === 0 ? {} : { promptCommentUrls }),
      })
      const parsed = result.task.source?.kind === 'github-issue' && 'parsed' in result.task.source
        ? result.task.source.parsed
        : null
      ctx.write(result, formatSummaryRows({
        issue: `${result.issue.repository}#${result.issue.number}`,
        issueUrl: result.issue.url,
        title: result.issue.title,
        labels: result.issue.labels.join(', ') || '(none)',
        importDisposition: result.import.disposition,
        importMode: result.import.mode,
        promptDigest: result.import.promptDigest ?? '',
        reviewPrompt: result.import.reviewPrompt == null
          ? ''
          : `${result.import.reviewPrompt.routedToTask ? 'routed-to-review-task' : 'stored-only'} via ${result.import.reviewPrompt.source}`,
        workType: parsed?.workType ?? '',
        priority: parsed?.priority ?? '',
        area: parsed?.area ?? '',
        specId: result.spec.id,
        taskId: result.task.id,
        repository: repository?.name ?? result.task.repositoryId ?? '',
        verificationCommands: result.task.verification.length,
        next: `ductum task list '${result.spec.name}' --project ${project.name}`,
      }))
    }))
}
