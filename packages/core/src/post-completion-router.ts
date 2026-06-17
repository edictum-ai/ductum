/**
 * Post-completion routing — impl → review → fix → ship lineage.
 *
 * `PostCompletionRouter` remains the public dispatcher entry point. The
 * implementation is split into focused route/helper modules so each file
 * stays below the repository's 300 LOC limit.
 */

import { PostCompletionBlindReviewRouter } from './post-completion-router-route-blind-review.js'

export {
  DEFAULT_MAX_FIX_ITERATIONS,
  type RouterContext,
  type RouterDispatchIntent,
} from './post-completion-router-types.js'
export { classifyTask, parseTaskName, type ParsedTaskName, type TaskKind } from './task-lineage.js'

export class PostCompletionRouter extends PostCompletionBlindReviewRouter {}
