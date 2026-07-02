import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '@/components/CopyButton'
import { Mono, tokens } from '@/components/signal'
import { shortHostPath } from '@/lib/display'

export function WorktreePathList({ paths }: { paths: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = paths.filter((path) => path.trim() !== '')
  if (visible.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button
        type="button"
        className="inline-flex w-fit items-center gap-1 font-mono text-[10px] text-muted-foreground/70 hover:text-foreground"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? 'Hide full paths' : 'Show full paths'}
      </button>
      {visible.map((path) => (
        <div key={path} style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 }}>
          <Mono size={11} color={tokens.mid} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={expanded ? path : shortHostPath(path)}>
            {expanded ? path : shortHostPath(path)}
          </Mono>
          <CopyButton value={path} className="shrink-0" />
        </div>
      ))}
    </div>
  )
}
