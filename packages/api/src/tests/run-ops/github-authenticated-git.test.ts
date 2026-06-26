import { describe, expect, it } from 'vitest'

import { buildGitHubAuthenticatedPullArgs } from '../../lib/run-ops/github-authenticated-git.js'

describe('GitHub authenticated git helpers', () => {
  it('builds post-merge pull args with a GitHub App auth header', () => {
    expect(buildGitHubAuthenticatedPullArgs({
      upstreamPath: '/repo',
      repo: { host: 'github.com', owner: 'edictum-ai', repo: 'ductum' },
      token: 'app-token',
      base: 'main',
    })).toEqual([
      '-C',
      '/repo',
      '-c',
      'http.https://github.com/.extraheader=AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46YXBwLXRva2Vu',
      'pull',
      '--ff-only',
      'origin',
      'main',
    ])
  })
})
