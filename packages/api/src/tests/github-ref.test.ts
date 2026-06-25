import { describe, expect, it } from 'vitest'

import { parseGitHubPullRef } from '../lib/github-ref.js'

describe('github-ref', () => {
  it('parses GitHub pull request URLs copied from tabs', () => {
    expect(parseGitHubPullRef('https://github.com/edictum-ai/ductum/pull/42')).toMatchObject({
      host: 'github.com',
      owner: 'edictum-ai',
      repo: 'ductum',
      pullNumber: 42,
    })
    expect(parseGitHubPullRef('https://github.com/edictum-ai/ductum/pull/42/files?plain=1#diff')).toMatchObject({
      pullNumber: 42,
      pullUrl: 'https://github.com/edictum-ai/ductum/pull/42',
    })
  })

  it('rejects non-pull URLs', () => {
    expect(parseGitHubPullRef('not a url')).toBeNull()
    expect(parseGitHubPullRef('https://github.com/edictum-ai/ductum/issues/42')).toBeNull()
    expect(parseGitHubPullRef('ssh://github.com/edictum-ai/ductum/pull/42')).toBeNull()
  })
})
