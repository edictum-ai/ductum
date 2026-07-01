import { useState } from 'react'

import type { RunActivity } from '@/api/client'
import { CommandBlock } from '@/components/CommandBlock'
import { JsonBlock } from '@/components/JsonBlock'
import { toolTone } from '@/lib/stage-display'
import { toneTextClass } from '@/components/signal'
import { activityShellCommand } from '@/lib/run-activity-command'
import { cn, formatTime } from '@/lib/utils'
import {
  describeActivityMessage,
  describeActivityResult,
  describeStructuredPayload,
  formatToolArg,
  operatorToolName,
  redactSensitiveText,
  type OperatorLabel,
} from '@/lib/run-activity-labels'
import { sanitizeActivityRaw } from './activity-raw'

interface ActivityGroup {
  kind: 'tool_calls' | 'tool_result' | 'text' | 'summary' | 'result'
  items: RunActivity[]
}

function groupActivity(activity: RunActivity[]): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const a of activity) {
    const last = groups[groups.length - 1]
    if (a.kind === 'tool_call' && last?.kind === 'tool_calls') {
      last.items.push(a)
    } else if (a.kind === 'result' && last?.kind === 'result' && last.items[0]!.content === a.content) {
      last.items.push(a)
    } else if (a.kind === 'tool_call') {
      groups.push({ kind: 'tool_calls', items: [a] })
    } else if (a.kind === 'tool_result') {
      groups.push({ kind: 'tool_result', items: [a] })
    } else if (a.kind === 'text' || a.kind === 'summary' || a.kind === 'result') {
      groups.push({ kind: a.kind, items: [a] })
    }
  }
  return groups
}

function toolColor(toolName: string | null): string {
  if (!toolName) return toneTextClass('mid')
  // Ductum's own MCP tools read in the rationed info tone, distinct but calm.
  if (toolName.startsWith('mcp__')) return toneTextClass('info')
  return toneTextClass(toolTone(toolName))
}

function toneClasses(tone: OperatorLabel['tone'] = 'info'): string {
  const classes = {
    ok: 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400',
    warn: 'border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400',
    err: 'border-red-100 bg-red-50 text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400',
    info: 'border-violet-100 bg-violet-50 text-violet-700 dark:border-violet-900/30 dark:bg-violet-950/20 dark:text-violet-400',
  }
  return classes[tone]
}

function OperatorMessage({ activity, fallbackClass }: { activity: RunActivity; fallbackClass: string }) {
  const [expanded, setExpanded] = useState(false)
  const label = describeActivityMessage(activity.content, activity.toolName) ?? describeStructuredPayload(activity.content, activity.toolName)
  if (!label) return <p className={fallbackClass}>{redactSensitiveText(activity.content)}</p>
  // Approval requests for Bash commands reach this branch (the harness posts
  // them as `summary` activity, which the summary group routes here directly).
  // Pull the command into a bounded CommandBlock so a long approval command
  // cannot wrap as `- <multi-KB command>` inline prose, and drop the duplicate
  // meta so the same command is not shown twice.
  const command = activityShellCommand(activity)
  const meta = command ? undefined : label.meta
  return (
    <div className={cn('rounded-md border px-3 py-2', toneClasses(label.tone))}>
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setExpanded(!expanded)}>
        <span className="shrink-0 font-mono text-[10px] opacity-55">{formatTime(activity.createdAt)}</span>
        <span className="min-w-0 flex-1 text-[13px] font-medium">{label.title}{meta ? <span className="font-normal opacity-75"> - {meta}</span> : null}</span>
        <span className="font-mono text-[10px] opacity-45">{expanded ? 'debug -' : 'debug +'}</span>
      </button>
      {command && (
        <div className="mt-2">
          <CommandBlock command={command} label="shell command" copyLabel="shell command" />
        </div>
      )}
      {expanded && <pre className="mt-2 whitespace-pre-wrap break-words border-t border-current/10 pt-2 font-mono text-[11px] opacity-75">{sanitizeActivityRaw(label.raw ?? activity.content)}</pre>}
    </div>
  )
}

function ResultGroup({ items }: { items: RunActivity[] }) {
  const [expanded, setExpanded] = useState(false)
  const content = items[0]!.content
  const first = items[0]!
  const last = items[items.length - 1]!
  const label = describeActivityResult(content, first.toolName)
  const looksLikeJson = (() => {
    const t = content.trim()
    if (t === '') return false
    const firstChar = t[0]
    if (firstChar !== '{' && firstChar !== '[') return false
    try {
      JSON.parse(t)
      return true
    } catch {
      return false
    }
  })()

  return (
    <div className={cn('rounded-md border', toneClasses(label?.tone))}>
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" onClick={() => setExpanded(!expanded)}>
        <span className="min-w-0 flex-1 break-words text-[13px] font-semibold">
          {label?.title ?? (looksLikeJson ? 'Tool returned structured data' : redactSensitiveText(content))}
          {label?.meta ? <span className="font-normal opacity-75"> - {label.meta}</span> : null}
        </span>
        {items.length > 1 && (
          <>
            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">×{items.length}</span>
            <span className="font-mono text-[10px] text-muted-foreground/40">{formatTime(first.createdAt)}–{formatTime(last.createdAt)}</span>
          </>
        )}
        <span className="font-mono text-[10px] opacity-45">{expanded ? 'debug -' : 'debug +'}</span>
      </button>
      {expanded && (
        <div className="border-t border-current/10 px-3 py-2">
          {looksLikeJson ? (
            <JsonBlock content={sanitizeActivityRaw(content)} label={`${first.toolName ?? 'result'} payload`} defaultCollapsed={false} />
          ) : (
            <div className="space-y-1">
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-2 py-0.5 font-mono text-[11px] text-muted-foreground/70">
                  <span className="shrink-0">{formatTime(item.createdAt)}</span>
                  <span className="whitespace-pre-wrap break-words">{sanitizeActivityRaw(item.content)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallRow({ activity }: { activity: RunActivity }) {
  const [expanded, setExpanded] = useState(false)
  const label = describeActivityMessage(activity.content, activity.toolName)
  if (label) return <OperatorMessage activity={activity} fallbackClass="" />
  const arg = formatToolArg(activity.content)
  const isMcp = activity.toolName?.startsWith('mcp__')
  const displayName = operatorToolName(activity.toolName)
  const isBlocked = arg.main.startsWith('BLOCKED:')
  const blockContent = isBlocked ? arg.main.slice(9).trim() : null
  const command = activityShellCommand(activity)

  if (isBlocked) {
    return (
      <div className="my-0.5">
        <button type="button" className="flex w-full items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-left font-mono text-[12px] dark:border-red-900/40 dark:bg-red-950/20" onClick={() => setExpanded(!expanded)}>
          <span className="shrink-0 pt-0.5 text-[10px] text-muted-foreground/30">{formatTime(activity.createdAt)}</span>
          <span className="shrink-0 font-semibold text-red-600 dark:text-red-400">Blocked by gate</span>
          <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">{displayName}</span>
          <span className={cn('min-w-0 flex-1 break-all text-muted-foreground/70', expanded ? 'whitespace-pre-wrap' : 'line-clamp-3')}>{blockContent}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground/40">{expanded ? 'debug -' : 'debug +'}</span>
        </button>
        {expanded && (
          <div className="mt-1">
            <JsonBlock content={sanitizeActivityRaw(activity.content)} label={`${activity.toolName ?? 'blocked tool'} args`} defaultCollapsed={false} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <button type="button" className="flex w-full items-start gap-1.5 py-0.5 text-left font-mono text-[12px]" onClick={() => setExpanded(!expanded)}>
        <span className="shrink-0 pt-0.5 text-[10px] text-muted-foreground/30">{formatTime(activity.createdAt)}</span>
        <span className={cn('shrink-0 font-semibold', toolColor(activity.toolName))}>{isMcp ? `Ductum: ${displayName}` : displayName}</span>
        {command ? (
          <span className="min-w-0 flex-1 break-words text-muted-foreground/70">
            {arg.detail ?? 'shell command below'}
          </span>
        ) : (
          <span className={cn('min-w-0 flex-1 break-all text-muted-foreground/70', expanded ? 'whitespace-pre-wrap' : 'line-clamp-3')}>{arg.main}</span>
        )}
        {!expanded && !command && arg.detail && <span className="shrink-0 text-[10px] text-muted-foreground/40">{arg.detail}</span>}
        <span className="shrink-0 text-[10px] text-muted-foreground/40">{expanded ? 'debug -' : 'debug +'}</span>
      </button>
      {command && (
        <div className="mt-1 mb-1">
          <CommandBlock command={command} label="shell command" copyLabel="shell command" />
        </div>
      )}
      {expanded && (
        <div className="mt-1 mb-1">
          <JsonBlock content={sanitizeActivityRaw(activity.content)} label={`${activity.toolName ?? 'tool'} args`} defaultCollapsed={false} />
        </div>
      )}
    </div>
  )
}

export function ActivityTab({ activity }: { activity: RunActivity[] }) {
  if (activity.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="live-dot mb-3 h-3 w-3 rounded-full bg-primary" />
        <p className="text-sm text-muted-foreground">Waiting for agent activity...</p>
      </div>
    )
  }
  const groups = groupActivity(activity)
  return (
    <div className="space-y-1">
      {groups.map((group, index) => {
        if (group.kind === 'tool_calls') {
          return <div key={index} className="rounded-md border border-border/20 bg-muted/10 px-3 py-1.5">{group.items.map((a) => <ToolCallRow key={a.id} activity={a} />)}</div>
        }
        if (group.kind === 'tool_result') return <ResultGroup key={index} items={group.items} />
        if (group.kind === 'text') {
          return <div key={index} className={cn('rounded-md border-l-2 border-l-primary/30 bg-muted/5 px-4 py-2.5', index > 0 && 'mt-1')}><OperatorMessage activity={group.items[0]!} fallbackClass="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/85" /></div>
        }
        if (group.kind === 'summary') {
          const a = group.items[0]!
          const label = describeActivityMessage(a.content, a.toolName) ?? describeStructuredPayload(a.content, a.toolName)
          if (label) return <OperatorMessage key={index} activity={a} fallbackClass="" />
          return (
            <div key={index} className="flex flex-wrap items-center gap-2 rounded-md bg-emerald-50 px-3 py-1.5 dark:bg-emerald-950/20">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="font-mono text-[10px] text-muted-foreground/40">{formatTime(a.createdAt)}</span>
              <span className="break-words text-[12px] font-medium text-emerald-700 dark:text-emerald-400">{redactSensitiveText(a.content)}</span>
            </div>
          )
        }
        return <ResultGroup key={index} items={group.items} />
      })}
    </div>
  )
}
