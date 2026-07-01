import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDuration(startStr: string, endStr?: string): string {
  const start = new Date(startStr).getTime()
  const end = endStr ? new Date(endStr).getTime() : Date.now()
  const seconds = Math.floor((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60) return `${minutes}m ${secs}s`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/**
 * Run-detail event time formatter. Every run-detail timestamp goes through
 * this helper so a single event can never appear as two unexplained clock
 * values: the time is rendered in the viewer's timezone AND labeled with that
 * timezone's abbreviation (e.g. `14:02 CEST`, `23:05 UTC`).
 *
 * Built from `formatToParts` so the `HH:MM tz` shape is stable across engines
 * instead of depending on `toLocaleTimeString`'s join punctuation.
 */
export function formatTime(dateStr: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(new Date(dateStr))
  let hh = ''
  let mm = ''
  let tz = ''
  for (const part of parts) {
    if (part.type === 'hour') hh = part.value
    else if (part.type === 'minute') mm = part.value
    else if (part.type === 'timeZoneName') tz = part.value
  }
  return tz ? `${hh}:${mm} ${tz}` : `${hh}:${mm}`
}

/** Format a date string as a full absolute timestamp with timezone label. */
export function formatAbsoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  })
}
