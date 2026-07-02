import type { Hono } from 'hono'
import { WorktreeCleanupError } from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { ValidationError } from '../lib/errors.js'
import { readJson } from '../lib/http.js'
import {
  buildOpsHealthReport,
  type OpsHealthCleanupInput,
  type OpsHealthCleanupResult,
} from '../lib/ops-health.js'
import { clearWorktreeInventoryCache } from '../lib/ops-health-worktrees.js'
import { recordAuditEvent, type AuditLogEventInput } from '../lib/audit-log.js'
import { getOperatorAuth } from '../middleware/operator-auth.js'
import { publicOutput } from '../lib/public-output.js'

/**
 * Issue #217: operator-facing ops-health surface. Reads run through
 * `buildOpsHealthReport`. The cleanup POST reuses
 * `context.cleanupWorktrees` (the same dispatcher-backed primitive the
 * existing `/api/factory/cleanup-worktrees` route uses) but requires an
 * explicit confirmation token so a stray click cannot delete worktrees.
 */

export function registerOpsHealthRoutes(app: Hono, context: ApiContext) {
  app.get('/api/factory/ops-health', async (c) => {
    const report = await buildOpsHealthReport(context)
    return c.json(publicOutput(report))
  })

  app.post('/api/factory/ops-health/cleanup-worktrees', async (c) => {
    const body = await readJson<OpsHealthCleanupInput>(c)
    if (body == null || body.confirm !== true) {
      throw new ValidationError(
        'Worktree cleanup requires explicit confirmation. Send `{ "confirm": true }` to remove inactive worktrees.',
      )
    }

    const actor = getOperatorAuth(c)?.actor ?? 'unknown-operator'
    const cleanupWorktrees = context.cleanupWorktrees
    const unavailableReason = cleanupUnavailableReason(context)
    if (unavailableReason != null || cleanupWorktrees == null) {
      const result: OpsHealthCleanupResult = {
        outcome: 'unavailable',
        removed: 0,
        reason: unavailableReason ?? 'Cleanup primitive is not loaded (dispatcher support unavailable).',
      }
      safeRecordAuditEvent(context, {
        actor,
        eventType: 'ops.cleanup_worktrees',
        status: 'unavailable',
        title: 'Worktree cleanup skipped — primitive unavailable',
        summary: result.reason,
        metadata: { outcome: result.outcome, removed: 0 },
      })
      return c.json(publicOutput(result))
    }

    const auditStartError = safeRecordAuditEvent(context, {
      actor,
      eventType: 'ops.cleanup_worktrees',
      status: 'started',
      title: 'Worktree cleanup requested',
      summary: 'Operator confirmed inactive worktree cleanup.',
      metadata: { confirmed: true },
    })
    if (auditStartError != null) {
      const result: OpsHealthCleanupResult = {
        outcome: 'error',
        removed: 0,
        reason: `Cleanup not started because audit logging failed: ${auditStartError}`,
      }
      return c.json(publicOutput(result))
    }

    let removed = 0
    try {
      removed = await cleanupWorktrees()
      clearWorktreeInventoryCache()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const partialRemoved = cleanupRemovedCount(error)
      if (partialRemoved > 0) clearWorktreeInventoryCache()
      const result: OpsHealthCleanupResult = {
        outcome: 'error',
        removed: partialRemoved,
        reason: partialRemoved === 0
          ? message
          : `${message} ${partialRemoved} inactive worktree directory(ies) were removed before cleanup failed.`,
      }
      safeRecordAuditEvent(context, {
        actor,
        eventType: 'ops.cleanup_worktrees',
        status: 'error',
        title: 'Worktree cleanup failed',
        summary: result.reason,
        metadata: { outcome: result.outcome, removed: partialRemoved },
      })
      return c.json(publicOutput(result))
    }

    const auditEndError = safeRecordAuditEvent(context, {
      actor,
      eventType: 'ops.cleanup_worktrees',
      status: 'success',
      title: 'Worktree cleanup completed',
      summary: `Removed ${removed} inactive worktree directory(ies).`,
      metadata: { outcome: 'success', removed },
    })
    const reasonParts = [
      removed === 0 ? 'No inactive worktrees matched the cleanup pass.' : null,
      auditEndError == null ? null : `Cleanup completed, but audit logging failed: ${auditEndError}`,
    ].filter((part): part is string => part != null)
    const result: OpsHealthCleanupResult = {
      outcome: 'success',
      removed,
      reason: reasonParts.length === 0 ? null : reasonParts.join(' '),
    }
    return c.json(publicOutput(result))
  })
}

function safeRecordAuditEvent(context: ApiContext, input: AuditLogEventInput): string | null {
  try {
    recordAuditEvent(context, input)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function cleanupUnavailableReason(context: ApiContext): string | null {
  if (context.cleanupWorktrees == null) return 'Cleanup primitive is not loaded (dispatcher support unavailable).'
  if (context.runtime.worktreeEnabled !== true) return 'Cleanup unavailable because worktree isolation is disabled.'
  if (context.runtime.worktreeBasePath == null || context.runtime.worktreeBasePath.trim() === '') {
    return 'Cleanup unavailable because no worktree base path is configured.'
  }
  return null
}

function cleanupRemovedCount(error: unknown): number {
  return error instanceof WorktreeCleanupError ? error.removed : 0
}
