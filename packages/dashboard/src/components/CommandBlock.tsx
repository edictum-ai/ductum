/**
 * CommandBlock — a bounded, copyable surface for a single shell command.
 *
 * Long commands used to render as tiny wrapped prose, which forced operators
 * back to the CLI to read them. This block keeps the command in a monospace
 * <pre> that scrolls (never wraps the page), caps its height so a multi-KB
 * dump cannot dominate the row, and exposes a copy button with an accessible
 * label so the command can be reused without re-typing.
 *
 * Clipboard policy (D186, review round 4): the copy button always writes the
 * same string that is rendered in the <pre>. Callers redact secrets before
 * passing `command` (e.g. via `redactSensitiveText`), so both the screen and
 * the clipboard receive the redacted form. The earlier `copyValue` prop that
 * let callers hand the original unredacted command to the clipboard was
 * rejected: it was the only UI path that surfaced a live secret through the
 * dashboard, and the button label `Copy shell command` did not disclose the
 * asymmetry. See decisions/186-run-detail-command-copy-operator-signoff.md.
 *
 * Mirrors JsonBlock's header/copy pattern so the two read as one system.
 */

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  /** Command string rendered verbatim inside the <pre>; usually redacted. */
  command: string
  /** Label shown above the block. */
  label?: string
  /** Accessible description appended to the copy button label. */
  copyLabel?: string
  /** Wrapper class name. */
  className?: string
}

export function CommandBlock({
  command,
  label = 'command',
  copyLabel = 'displayed shell command',
  className,
}: Props) {
  const [copied, setCopied] = useState(false)

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be unavailable in insecure contexts — ignore silently.
    }
  }

  const lineCount = command.split('\n').length

  return (
    <div className={cn('rounded-md border border-border/30 bg-muted/20', className)}>
      <div className="flex items-center gap-2 border-b border-border/20 px-2.5 py-1.5">
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          {label}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground/40">
          {lineCount.toLocaleString()} line{lineCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/60 hover:bg-accent/40 hover:text-foreground"
          onClick={copyToClipboard}
          aria-label={`Copy ${copyLabel}`}
        >
          {copied ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre p-3 font-mono text-[11px] leading-relaxed text-foreground/80">
        {command}
      </pre>
    </div>
  )
}
