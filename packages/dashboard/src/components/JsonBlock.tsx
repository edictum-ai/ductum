/**
 * JsonBlock — pretty-prints any string that looks like JSON.
 *
 * Used by the RunDetail page wherever an activity or evidence
 * payload arrives as a raw content string. If the string parses as
 * JSON we render it as indented, monospace, syntax-ish highlighted
 * text in a <pre>. If it's not JSON we render it as preformatted
 * text. Either way the block is collapsible when long (default
 * threshold 400 chars / 12 lines) and has a copy-to-clipboard
 * button.
 *
 * Kept agnostic of any shape so it can absorb the different
 * backends' quirks: Claude tool_result strings, Codex event.result,
 * evidence payloads from the edictum runtime, etc.
 */

import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

const DEFAULT_COLLAPSE_CHARS = 400
const DEFAULT_COLLAPSE_LINES = 12

interface Props {
  /** Raw content string. Parsed as JSON when possible. */
  content: string
  /** Optional label shown above the block. */
  label?: string
  /** Start collapsed. Default: true when content exceeds thresholds. */
  defaultCollapsed?: boolean
  /** Override the default character threshold. */
  collapseChars?: number
  /** Override the default line threshold. */
  collapseLines?: number
  /** Wrapper class name. */
  className?: string
}

function tryParseJson(content: string): unknown {
  const trimmed = content.trim()
  if (trimmed === '') return undefined
  const first = trimmed[0]
  if (first !== '{' && first !== '[' && first !== '"') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

export function JsonBlock({
  content,
  label,
  defaultCollapsed,
  collapseChars = DEFAULT_COLLAPSE_CHARS,
  collapseLines = DEFAULT_COLLAPSE_LINES,
  className,
}: Props) {
  const [copied, setCopied] = useState(false)

  const { formatted, isJson, lineCount, charCount } = useMemo(() => {
    const parsed = tryParseJson(content)
    if (parsed !== undefined) {
      const formatted = JSON.stringify(parsed, null, 2)
      return {
        formatted,
        isJson: true,
        lineCount: formatted.split('\n').length,
        charCount: formatted.length,
      }
    }
    return {
      formatted: content,
      isJson: false,
      lineCount: content.split('\n').length,
      charCount: content.length,
    }
  }, [content])

  const isLong = charCount > collapseChars || lineCount > collapseLines
  const initialCollapsed = defaultCollapsed ?? isLong
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(formatted)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore — clipboard can be unavailable in insecure contexts
    }
  }

  return (
    <div className={cn('rounded-md border border-border/30 bg-muted/20', className)}>
      <div className="flex items-center gap-2 border-b border-border/20 px-2.5 py-1.5">
        {isLong && (
          <button
            type="button"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          {label ?? (isJson ? 'json' : 'text')}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground/40">
          {lineCount.toLocaleString()} line{lineCount === 1 ? '' : 's'} · {charCount.toLocaleString()} chars
        </span>
        <button
          type="button"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground"
          onClick={copyToClipboard}
          aria-label="Copy to clipboard"
        >
          {copied ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      {!collapsed && (
        <pre className="overflow-x-auto whitespace-pre p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
          {formatted}
        </pre>
      )}
      {collapsed && (
        <button
          type="button"
          className="w-full px-3 py-1.5 text-left font-mono text-[10px] text-muted-foreground/50 hover:text-foreground"
          onClick={() => setCollapsed(false)}
        >
          click to expand
        </button>
      )}
    </div>
  )
}
