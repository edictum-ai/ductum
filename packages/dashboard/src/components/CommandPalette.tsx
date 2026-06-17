import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAllRuns, useOperatorBrief, useRepairReport, useSearch } from '@/api/hooks'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TYPE_LABEL, buildOperatorPaletteActions, resultIcon, type PaletteItem } from './command-palette-actions'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { data: runs = [] } = useAllRuns({ limit: '200' })
  const { data: brief } = useOperatorBrief()
  const { data: repair } = useRepairReport()

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    function onOpenSearch() {
      setOpen(true)
    }
    window.addEventListener('ductum:open-command-palette', onOpenSearch)
    return () => window.removeEventListener('ductum:open-command-palette', onOpenSearch)
  }, [])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  // Debounce the search query by 200 ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200)
    return () => clearTimeout(t)
  }, [query])

  const { data: results = [] } = useSearch(debouncedQuery)
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const operatorActions = buildOperatorPaletteActions({ runs, brief, repair })
    const actions = normalized === ''
      ? operatorActions
      : operatorActions.filter((action) => `${action.name} ${action.subtitle} ${action.label}`.toLowerCase().includes(normalized))
    const searchItems = results.map((result): PaletteItem => ({
      id: `${result.type}-${result.id}`,
      name: result.name,
      subtitle: result.subtitle ?? '',
      url: result.url,
      label: TYPE_LABEL[result.type],
      icon: resultIcon(result.type),
    }))
    return [...actions, ...searchItems]
  }, [brief, query, repair, results, runs])

  // Reset selected index when results change
  useEffect(() => { setSelectedIdx(0) }, [items])

  function handleOpenChange(v: boolean) {
    setOpen(v)
    if (!v) {
      setQuery('')
      setDebouncedQuery('')
      setSelectedIdx(0)
    }
  }

  function goTo(url: string) {
    navigate(url)
    handleOpenChange(false)
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = items[selectedIdx]
      if (hit) goTo(hit.url)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] -translate-y-0 max-w-xl overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search actions, projects, specs, tasks, attempts, decisions, and agents
        </DialogDescription>

        {/* Search input row */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          <Input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search actions, projects, specs, tasks, attempts, decisions, agents…"
            className="h-11 border-0 bg-transparent text-sm focus-visible:border-0 focus-visible:ring-0"
          />
          <kbd className="hidden shrink-0 rounded border border-border/40 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60 sm:inline-flex">
            ESC
          </kbd>
        </div>

        {/* Results */}
        {items.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-2">
            {items.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                    i === selectedIdx
                      ? 'bg-accent/80 text-accent-foreground'
                      : 'hover:bg-accent/40',
                  )}
                  onClick={() => goTo(r.url)}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  {r.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.name}</span>
                    {r.subtitle.trim() !== '' && (
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground/60">
                        {r.subtitle}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground/50">
                    {r.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Empty state */}
        {query.length > 0 && items.length === 0 && debouncedQuery === query && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No results for &ldquo;{query}&rdquo;
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
