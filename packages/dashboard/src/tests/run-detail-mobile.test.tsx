import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Agent, GateEvaluation, RunActivity } from '@/api/client'
import { RunDetailHero } from '@/pages/run-detail/hero'
import { RunDetailTabs } from '@/pages/run-detail/detail-tabs'
import { RunSignalGrid, RunStatsStrip } from '@/pages/run-detail/overview-panels'
import type { RunType } from '@/pages/run-detail/types'

// Mobile is a first-class failure mode for run detail (issue #211): long
// stats strips, two-column signal grids, the hero title, and the 7-tab bar all
// have to collapse below ~390px without forcing horizontal page scroll. These
// tests pin the responsive structure so a regression to a fixed inline grid is
// caught before it ships.

const NOW = new Date().toISOString()

const run = {
  id: 'run_longidentifier_mobile_fixture',
  stage: 'implement',
  terminalState: null,
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  createdAt: NOW,
  lastHeartbeat: NOW,
  prNumber: null,
  commitSha: null,
  branch: null,
} as unknown as RunType

describe('run-detail mobile layout', () => {
  it('collapses the stats strip from six columns to one on mobile', () => {
    const { container } = render(<RunStatsStrip run={run} agent={undefined as unknown as Agent} />)
    const strip = container.firstElementChild

    expect(strip?.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(strip?.className).toMatch(/sm:grid-cols-2/)
    expect(strip?.className).toMatch(/lg:grid-cols-6/)
  })

  it('collapses the two-column signal grid to one column on mobile', () => {
    const { container } = render(
      <RunSignalGrid run={run} gates={[] as GateEvaluation[]} activity={[] as RunActivity[]} />,
    )
    const grid = container.firstElementChild

    expect(grid?.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(grid?.className).toMatch(/lg:grid-cols-\[1\.2fr_1fr\]/)
  })

  it('lets the hero title wrap and stack instead of overflowing on mobile', () => {
    const { container } = render(
      <RunDetailHero
        run={run}
        taskTitle="P1-RUN-DETAIL-SHELL-TIME-MOBILE-very-long-task-name"
        summaryText=""
        statusLabel="Running"
        toneColor="#888"
        running={false}
        approval={false}
        activity={[]}
      />,
    )
    const hero = container.firstElementChild
    const title = container.querySelector('h1')

    expect(hero?.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(hero?.className).toMatch(/lg:grid-cols-\[1fr_auto\]/)
    expect(title?.className).toMatch(/break-words/)
  })

  it('wraps long run ids inside the hero meta row instead of overflowing on mobile', () => {
    // Run ids are UUID-shaped with no natural break points; without an explicit
    // break-all wrapper a long id pushes the hero meta row past the viewport.
    // Pin the wrapper so a regression to a bare Mono span is caught.
    const longRunId = 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_mobile'
    const longRun = { ...run, id: longRunId } as unknown as RunType
    const { container } = render(
      <RunDetailHero
        run={longRun}
        taskTitle="Short title"
        summaryText=""
        statusLabel="Running"
        toneColor="#888"
        running={false}
        approval={false}
        activity={[]}
      />,
    )

    const idWrapper = container.querySelector('span.break-all')
    expect(idWrapper).not.toBeNull()
    expect(idWrapper?.textContent).toBe(longRunId)
    expect(idWrapper?.className).toMatch(/min-w-0/)
    expect(idWrapper?.className).toMatch(/max-w-full/)
  })

  it('keeps the seven-tab bar inside the viewport on mobile', () => {
    const { container } = render(
      <RunDetailTabs
        activity={[]}
        evidence={[]}
        transitions={[]}
        gates={[]}
        decisions={[]}
        updates={[]}
        sseStatus="connected"
      />,
    )
    const tablist = container.querySelector('[role="tablist"]')

    // Horizontal scroll on the tablist prevents the nowrap tabs from blowing
    // out the page width on a narrow viewport.
    expect(tablist?.className).toMatch(/overflow-x-auto/)
    expect(tablist?.className).toMatch(/max-w-full/)
  })
})
