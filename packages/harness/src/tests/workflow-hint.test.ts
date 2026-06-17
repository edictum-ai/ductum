import { describe, expect, it } from 'vitest'

import { buildWorkflowHint } from '../workflow-hint.js'

describe('workflow hint', () => {
  it('renders current stage reads and allowed tools for app-server harnesses', () => {
    expect(buildWorkflowHint({
      activeStage: 'understand',
      stages: [
        {
          id: 'understand',
          tools: ['Read', 'Bash'],
          exit: [
            { condition: 'file_read("README.md")', message: 'Read README.md before editing' },
            { condition: 'file_read("CLAUDE.md")', message: 'Read CLAUDE.md before editing' },
          ],
        },
        { id: 'implement', tools: ['Read', 'Write', 'Bash'], exit: [] },
      ],
    })).toContain('First read these files before editing: README.md, CLAUDE.md')
  })
})
