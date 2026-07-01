import { useMemo, useState } from 'react'
import { FileDiff, FilePlus, FileMinus, FileWarning } from 'lucide-react'

import type { RunDiff, RunDiffFile } from '@/api/client'
import { Card, CardContent } from '@/components/ui/card'
import { redactSensitiveText } from '@/lib/run-activity-labels'
import { cn } from '@/lib/utils'

interface DiffViewerProps {
  diff: RunDiff | undefined
  isLoading: boolean
  error: unknown
}

/** Parse a unified diff into per-file chunks keyed by the post-image path. */
export function splitDiffByFile(rawDiff: string): Map<string, string> {
  const fileDiffs = new Map<string, string>()
  if (rawDiff === '' || rawDiff.startsWith('(failed')) return fileDiffs

  const lines = rawDiff.split('\n')
  let currentPath: string | null = null
  let currentChunk: string[] = []

  const flush = () => {
    if (currentPath != null && currentChunk.length > 0) {
      fileDiffs.set(currentPath, currentChunk.join('\n'))
    }
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      // `diff --git a/<path> b/<path>` — take the b/ path as the file key.
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/)
      currentPath = match?.[2] ?? null
      currentChunk = [line]
    } else if (currentPath != null) {
      currentChunk.push(line)
    }
  }
  flush()
  return fileDiffs
}

/** Render a unified diff chunk with red/green line highlighting. */
function DiffLines({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <pre className="overflow-x-auto font-mono text-[11px] leading-[1.4]">
      {lines.map((line, idx) => {
        const safeLine = redactSensitiveText(line)
        let cls = 'text-muted-foreground/80'
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-muted-foreground font-semibold'
        else if (line.startsWith('@@')) cls = 'text-cyan-600 dark:text-cyan-400'
        else if (line.startsWith('+')) cls = 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
        else if (line.startsWith('-')) cls = 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200'
        else if (line.startsWith('diff --git')) cls = 'text-primary font-semibold mt-2'
        return (
          <div key={idx} className={cn('whitespace-pre px-3 py-0.5', cls)}>
            {safeLine || '\u00A0'}
          </div>
        )
      })}
    </pre>
  )
}

function FileIcon({ file }: { file: RunDiffFile }) {
  if (file.status === 'binary') return <FileWarning className="h-3 w-3 text-amber-500" />
  if (file.deletions === 0 && file.insertions > 0) return <FilePlus className="h-3 w-3 text-emerald-500" />
  if (file.insertions === 0 && file.deletions > 0) return <FileMinus className="h-3 w-3 text-red-500" />
  return <FileDiff className="h-3 w-3 text-muted-foreground/60" />
}

export function DiffViewer({ diff, isLoading, error }: DiffViewerProps) {
  const fileChunks = useMemo(() => splitDiffByFile(diff?.diff ?? ''), [diff?.diff])
  const files = diff?.files ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const activePath = selected ?? files[0]?.path ?? null

  if (isLoading) {
    return (
      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-4">
          <div className="shimmer h-40 rounded-md bg-muted/30" />
        </CardContent>
      </Card>
    )
  }

  if (error != null) {
    const msg = error instanceof Error ? error.message : String(error)
    return (
      <Card className="border-amber-500/30 bg-amber-50/10 dark:bg-amber-950/20">
        <CardContent className="p-4">
          <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <FileWarning className="h-4 w-4" />
            Could not load diff — {msg}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The attempt may not have a worktree yet, or the base branch may not exist in it.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (diff == null || diff.files.length === 0) {
    if (diff?.truncated) {
      return (
        <Card className="border-amber-500/30 bg-amber-50/10 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <FileWarning className="h-4 w-4" />
              Diff incomplete against {diff.base}.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ductum could not fully collect the worktree diff, so this should not be treated as a clean attempt.
            </p>
            {diff.diff.trim() !== '' && (
              <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border/40 bg-muted/20 p-3 text-[11px] text-muted-foreground">
                {redactSensitiveText(diff.diff)}
              </pre>
            )}
          </CardContent>
        </Card>
      )
    }
    return (
      <Card className="border-border/40 bg-card/40">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">No changes detected against {diff?.base ?? 'main'}.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/40 bg-card/40">
      <CardContent className="p-0">
        {/* Header with totals */}
        <div className="flex items-center justify-between border-b border-border/30 px-4 py-2">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold">Diff vs {diff.base}</span>
            <span className="text-muted-foreground/70">
              {diff.totals.files} {diff.totals.files === 1 ? 'file' : 'files'}
            </span>
            <span className="font-mono text-emerald-600 dark:text-emerald-400">+{diff.totals.insertions}</span>
            <span className="font-mono text-red-600 dark:text-red-400">-{diff.totals.deletions}</span>
          </div>
          {diff.truncated && (
            <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400">truncated</span>
          )}
        </div>

        <div className="grid grid-cols-[220px_1fr]">
          {/* File list */}
          <div className="max-h-[520px] overflow-y-auto border-r border-border/30 py-1">
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => setSelected(f.path)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono',
                  'hover:bg-accent/40',
                  activePath === f.path && 'bg-accent/60 text-foreground',
                  activePath !== f.path && 'text-muted-foreground',
                )}
                title={f.path}
              >
                <FileIcon file={f} />
                <span className="flex-1 truncate">{f.path}</span>
                {f.status === 'text' && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                    <span className="text-emerald-600 dark:text-emerald-400">+{f.insertions}</span>
                    {' '}
                    <span className="text-red-600 dark:text-red-400">-{f.deletions}</span>
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Diff content */}
          <div className="max-h-[520px] overflow-y-auto bg-muted/10">
            {activePath != null && fileChunks.has(activePath) ? (
              <DiffLines text={fileChunks.get(activePath)!} />
            ) : activePath != null ? (
              <div className="p-4 text-xs text-muted-foreground">
                (Binary or truncated file — no inline diff available)
              </div>
            ) : (
              <div className="p-4 text-xs text-muted-foreground">Select a file to see its diff.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
