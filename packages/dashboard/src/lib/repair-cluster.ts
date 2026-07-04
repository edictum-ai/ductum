/**
 * Repair-item clustering.
 *
 * Operators see dozens of attempts hit the same root cause (a missing external
 * outcome, a dirty worktree, a linked commit without lineage). The dashboard
 * surfaces those as one cluster per root cause — never one card per attempt —
 * while preserving the exact IDs, links, and per-record recovery commands that
 * each affected item needs.
 *
 * Cluster stability rule (matches the operator UX contract):
 *   group by `severity | (issueCode OR title) | reason`
 * and NEVER by the literal `suggestedAction`. The action text frequently embeds
 * per-record IDs (task id, branch, commit sha) which would otherwise split a
 * single root cause into N separate cards. When an item carries an `issueCode`
 * (the canonical enum from the API), it overrides the title as the cluster
 * category — title is just a humanized form of the code.
 *
 * When every item in the cluster resolves to the same copyable command we lift
 * that command to the cluster header. When the command varies per record (the
 * common case for `linked_commit_without_lineage`), each affected record renders
 * its own command — the operator still gets one cluster with one reason and one
 * next-action label, plus N concrete copyable commands.
 */

import type { RepairItem, RepairSeverity } from '@/lib/repair'

export interface RepairItemCluster {
  /** Stable cluster id; safe to use as a React key. */
  id: string
  title: string
  reason: string
  severity: RepairSeverity
  /**
   * Shared, non-record-specific action label shown once at the cluster header.
   * Falls back to the first item's suggestedAction with placeholders already
   * flagged. Always populated.
   */
  actionLabel: string
  /**
   * Shared copyable command, when every item in the cluster resolves to the
   * same `ductum ...` command. Null when items have per-record commands or no
   * command at all.
   */
  sharedCommand: string | null
  /**
   * True when at least one item carries its own copyable command. The cluster
   * header action stays as prose; each affected record renders its command.
   */
  hasPerRecordCommands: boolean
  items: RepairItem[]
}

/**
 * Group repair items into stable clusters. Items with the same severity +
 * (issueCode OR title) + reason collapse into one cluster; per-record action
 * text is intentionally NOT part of the key.
 *
 * Sort order: blockers first, then alphabetical by title — same as before.
 */
export function clusterRepairItems(items: RepairItem[]): RepairItemCluster[] {
  const buckets = new Map<string, RepairItem[]>()
  for (const item of items) {
    const key = clusterKey(item)
    const bucket = buckets.get(key)
    if (bucket == null) buckets.set(key, [item])
    else bucket.push(item)
  }
  const clusters: RepairItemCluster[] = []
  for (const [key, bucket] of buckets) {
    clusters.push(buildCluster(key, bucket))
  }
  return clusters.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'blocker' ? -1 : 1
    return left.title.localeCompare(right.title)
  })
}

/**
 * Extract a `ductum ...` copyable command from an action string. Returns null
 * when the action is prose, not a command, or when the command contains an
 * unresolved `<placeholder>` token that the operator must fill in by hand.
 */
export function commandFromAction(action: string): string | null {
  const trimmed = action.trim()
  if (hasPlaceholder(trimmed)) return null
  return trimmed.startsWith('ductum ') ? trimmed : null
}

/**
 * Detects literal placeholder tokens like `<placeholder>`, `<attemptId>`, etc.
 * Such commands cannot be copied verbatim — the operator would have to hand-edit
 * the angle brackets out, which the audit flagged as a UX failure.
 */
export function hasPlaceholder(value: string): boolean {
  return /<[^>\s]+>/.test(value)
}

function buildCluster(id: string, items: RepairItem[]): RepairItemCluster {
  const first = items[0]!
  const commands = items.map((item) => commandFromAction(item.suggestedAction))
  const validCommands = commands.filter((cmd): cmd is string => cmd != null)
  const validCommandCount = validCommands.length
  const allCommandsValid = validCommandCount === items.length
  const firstCommand = validCommands[0] ?? null
  const sameCommand = allCommandsValid && validCommands.every((cmd) => cmd === firstCommand)
  const sharedCommand = sameCommand ? firstCommand : null
  const hasPerRecordCommands = !sameCommand && validCommandCount > 0
  return {
    id,
    title: first.title,
    reason: first.reason,
    severity: first.severity,
    actionLabel: clusterActionLabel({ items, sharedCommand, hasPerRecordCommands }),
    sharedCommand,
    hasPerRecordCommands,
    items,
  }
}

/**
 * The cluster-level action label answers "what do I do next?" without forcing
 * the operator to open a transcript. The label is always prose, never a raw
 * command — copyable commands render as their own code blocks.
 *
 *  - If every item shares one literal command, `sharedCommand` carries it and
 *    the cluster header renders that command via CommandAction; the label is
 *    not visible but is still descriptive for assistive tech.
 *  - If items carry per-record commands, the header points down to them so the
 *    operator knows each affected row has its own copyable command.
 *  - If every item is blocked by an unresolved `<placeholder>`, the label says
 *    so explicitly. The contract forbids rendering `<placeholder>` verbatim.
 *  - Otherwise (pure prose actions) the label is the first item's action text.
 */
function clusterActionLabel({
  items,
  sharedCommand,
  hasPerRecordCommands,
}: {
  items: RepairItem[]
  sharedCommand: string | null
  hasPerRecordCommands: boolean
}): string {
  if (sharedCommand != null) {
    return 'Use the copyable recovery command below for each affected record.'
  }
  if (hasPerRecordCommands) {
    return 'Use the per-record recovery commands below for each affected record.'
  }
  if (items.every((item) => hasPlaceholder(item.suggestedAction))) {
    return 'Action needs a concrete record value before it can be copied.'
  }
  return items[0]!.suggestedAction.trim()
}

/**
 * Stable cluster key. Items collapse into one cluster when they share:
 *   - severity (blocker vs attention never merge)
 *   - root cause category — the issueCode when present, else the title as a
 *     fallback proxy (e.g. for factory-setup items that have no enum code)
 *   - normalized reason text
 *
 * The literal suggestedAction is intentionally NOT part of the key: the API
 * frequently embeds per-record ids (task id, branch, commit sha) into the
 * action text, and keying on it would split one root cause into N cards.
 */
function clusterKey(item: RepairItem): string {
  return [
    item.severity,
    item.issueCode ?? normalize(item.title),
    normalize(item.reason),
  ].join('|')
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}
