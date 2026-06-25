import { createHash } from 'node:crypto'
import type {
  GitHubIssuePromptSection,
  GitHubIssuePromptSource,
  GitHubPromptSectionHeading,
} from '@ductum/core'

import { ValidationError } from './errors.js'
import type { GitHubIssueCommentRecord, GitHubIssueRecord } from './github-client.js'

interface PromptSourceDocument {
  sourceKind: GitHubIssuePromptSection['sourceKind']
  sourceUrl: string
  commentUrl?: string | null
  body: string
}

interface ParsedDocumentSection extends GitHubIssuePromptSection {}

export function buildPromptImportSource(input: {
  issue: GitHubIssueRecord
  comments: GitHubIssueCommentRecord[]
  owner: string
  repo: string
  importedAt: string
  reviewPromptRoutedToTask: boolean
  promptCommentUrls?: string[]
}): GitHubIssuePromptSource | null {
  const selectedComments = selectPromptComments(input.comments, input.promptCommentUrls ?? [])
  const sections = collectPromptSections(input.issue, selectedComments)
  if (!hasExplicitPromptSections(sections)) return null

  const implementation = selectImplementationSection(sections)
  const review = selectSingleSection(sections, 'Review Prompt', 'review')
  const promptDigest = sha256([
    implementation.heading,
    implementation.digest,
    review.heading,
    review.digest,
  ].join('\n'))

  return {
    kind: 'github-issue',
    provider: 'github',
    repoOwner: input.owner,
    repoName: input.repo,
    issueNumber: input.issue.number,
    issueUrl: input.issue.html_url,
    title: input.issue.title,
    labels: input.issue.labels.map((label) => typeof label === 'string' ? label : label.name ?? '').filter((label) => label !== ''),
    importedAt: input.importedAt,
    promptImport: {
      mode: 'prompt-sections',
      promptDigest,
      reviewPromptRoutedToTask: input.reviewPromptRoutedToTask,
      implementation,
      review,
    },
  }
}

function collectPromptSections(issue: GitHubIssueRecord, comments: GitHubIssueCommentRecord[]): ParsedDocumentSection[] {
  return [
    parsePromptSections({ sourceKind: 'issue-body', sourceUrl: issue.html_url, body: issue.body }),
    ...comments.map((comment) => parsePromptSections({
      sourceKind: 'issue-comment',
      sourceUrl: comment.html_url,
      commentUrl: comment.html_url,
      body: comment.body,
    })),
  ].flat()
}

function selectPromptComments(comments: GitHubIssueCommentRecord[], promptCommentUrls: string[]): GitHubIssueCommentRecord[] {
  const selectedUrls = promptCommentUrls.map((url) => url.trim()).filter((url) => url !== '')
  if (selectedUrls.length === 0) return []
  const commentsByUrl = new Map(comments.map((comment) => [comment.html_url, comment]))
  return selectedUrls.map((url) => {
    const comment = commentsByUrl.get(url)
    if (comment == null) {
      throw new ValidationError(`GitHub issue prompt import selected comment was not found: ${url}`)
    }
    return comment
  })
}

function parsePromptSections(document: PromptSourceDocument): ParsedDocumentSection[] {
  const sections = new Map<GitHubPromptSectionHeading, string[]>()
  let currentHeading: GitHubPromptSectionHeading | null = null
  let buffer: string[] = []
  for (const line of document.body.replace(/\r\n/g, '\n').split('\n')) {
    const heading = parsePromptHeading(line)
    if (heading != null) {
      if (currentHeading != null) appendSection(sections, currentHeading, buffer)
      currentHeading = heading
      buffer = []
      continue
    }
    if (currentHeading != null) buffer.push(line)
  }
  if (currentHeading != null) appendSection(sections, currentHeading, buffer)
  return [...sections.entries()].map(([heading, values]) => {
    if (values.length > 1) {
      throw new ValidationError(`GitHub issue prompt import found duplicate ${heading} sections in ${document.sourceUrl}`)
    }
    const body = values[0]!.trim()
    if (body === '') {
      throw new ValidationError(`GitHub issue prompt import found an empty ${heading} section in ${document.sourceUrl}`)
    }
    return {
      heading,
      body,
      digest: sha256(`${heading}\n${body}`),
      sourceKind: document.sourceKind,
      sourceUrl: document.sourceUrl,
      ...(document.commentUrl == null ? {} : { commentUrl: document.commentUrl }),
    }
  })
}

function appendSection(sections: Map<GitHubPromptSectionHeading, string[]>, heading: GitHubPromptSectionHeading, buffer: string[]): void {
  const body = cleanupSection(buffer.join('\n'))
  if (body === '') return
  sections.set(heading, [...(sections.get(heading) ?? []), body])
}

function cleanupSection(value: string): string {
  return value.trim()
}

function parsePromptHeading(line: string): GitHubPromptSectionHeading | null {
  const match = line.match(/^#{1,6}\s+(Implementation Prompt|Execution Prompt|Review Prompt)\s*$/)
  return match?.[1] as GitHubPromptSectionHeading | null
}

function hasExplicitPromptSections(sections: ParsedDocumentSection[]): boolean {
  return sections.some((section) => (
    section.heading === 'Implementation Prompt'
    || section.heading === 'Execution Prompt'
    || section.heading === 'Review Prompt'
  ))
}

function selectImplementationSection(sections: ParsedDocumentSection[]): ParsedDocumentSection {
  return trySelectSingleSection(sections, 'Implementation Prompt', 'implementation')
    ?? trySelectSingleSection(sections, 'Execution Prompt', 'implementation/execution')
    ?? raiseMissingImplementation()
}

function raiseMissingImplementation(): never {
  throw new ValidationError('GitHub issue prompt import requires an Implementation Prompt or Execution Prompt section')
}

function selectSingleSection(
  sections: ParsedDocumentSection[],
  heading: GitHubPromptSectionHeading,
  label: string,
): ParsedDocumentSection {
  const selected = trySelectSingleSection(sections, heading, label)
  if (selected == null) {
    throw new ValidationError(`GitHub issue prompt import is missing a ${heading} section`)
  }
  return selected
}

function trySelectSingleSection(
  sections: ParsedDocumentSection[],
  heading: GitHubPromptSectionHeading,
  label: string,
): ParsedDocumentSection | null {
  const candidates = sections.filter((section) => section.heading === heading)
  if (candidates.length === 0) return null
  const uniqueDigests = new Set(candidates.map((section) => section.digest))
  if (uniqueDigests.size > 1) {
    throw new ValidationError(`GitHub issue prompt import found conflicting ${label} sections across issue body/comments`)
  }
  return candidates.find((section) => section.sourceKind === 'issue-body') ?? candidates[0]!
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
