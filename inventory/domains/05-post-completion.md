# Post-Completion Pipeline

> Inventory pass · 2026-06-16 · disposition is a recommendation; the operator decides.

The post-completion pipeline is the most mature orchestration surface in the repo: a cleanly-split impl->verify->review->fix->ship lineage built as a single class-inheritance chain (8 router files), backed by a hardened verdict parser, bounded prompts, typed worktree-snapshot evidence, auto-commit, and git-artifact sync. It is live-core and largely solid, with strong adversarial-review provenance (D060/D116/D123 verdict anchors, C6/C7 honored: fix output is never parsed as a verdict, reviewer agent must differ). The two real liabilities are (1) the secrets-leak: verifyWorktree inherits the entire host process.env and only deletes DUCTUM_OPERATOR_TOKEN, and (2) legacy Target vocabulary (targetId) still threaded through every task-creation call despite D169 retiring it. Worker-death recovery and sandbox confinement are out-of-domain but the verify path is the laptop-bound execution point. post-completion.ts has also silently drifted from its grandfathered 483 LOC to 637 LOC because the file-size gate matches by path, not recorded size.

## Review/fix/verify lineage router (impl->verify->review->fix->ship)
- **What:** The orchestration spine that runs after an agent completes: rebase onto base, auto-commit dirty worktree, verify build+tests, dispatch a different-agent review, route the verdict to PASS->ship or WARN/FAIL->fix, bounded by maxFixIterations. Split across 8 files via a class-inheritance chain (Base -> Lineage -> TaskCompletion -> Dispatch -> VerificationFix -> Impl -> Fix -> Review -> BlindReview) so each stays under 300 LOC.
- **Where:** `post-completion-router-route-impl.ts:16` (runImplCompletion), `post-completion-router-route-review.ts:17` (runReviewCompletion), `post-completion-router-route-fix.ts:11` (runFixCompletion), `post-completion-router.ts:18` (public class), dispatched from `dispatcher-session.ts:88-96`.
- **Maturity:** live-core
- **Quality:** solid — exercised end-to-end (recovery closeout D131), C6/C7 honored (fix output never parsed as a verdict, `post-completion-router-route-fix.ts:9`; reviewer must differ from implementer via resolveReviewerAgent), lineage-already-shipped guard on every entry path.
- **Operator-legibility risk:** partial — escalation reasons like `max_review_iterations (N) exceeded` and stage_history breadcrumbs are emitted, but understanding why a chain stalled still requires reading run/stage history rather than a single operator-facing status.
- **Dependencies:** RouterContext (run/task/spec/project/evidence repos, state machine, event emitter, PostCompletionConfig callbacks); dispatcher owns the call into it; depends on task-lineage classifyTask and bakeoff modules.
- **Disposition (recommended):** KEEP — fits the current model, well-factored, proven.
- **Flags:** legacy — every task-creation site (`post-completion-router-route-review.ts:127`, `post-completion-router-dispatch.ts:57,109`, `post-completion-router-verification-fix.ts:42`) still sets `targetId: originalTask.targetId` alongside the new repositoryId/componentId; D169 retired the Target surface but the field persists in the Task type (`types.ts:152`).

## Reviewer verdict parser (parseReviewResult)
- **What:** Parses a reviewer agent's completion into PASS/WARN/FAIL with three acceptance anchors (final-verdict heading, strict terminal line, leading-verdict-with-contradiction-check) and rejects malformed/downgrade-attack shapes.
- **Where:** `post-completion.ts:492` (parseReviewResult) plus helpers `locateVerdictUnderHeading:517`, `locateTerminalVerdict:546`, `locateLeadingVerdict:586`; format rule constant `REVIEW_VERDICT_FORMAT_RULE:424`.
- **Maturity:** live-core
- **Quality:** solid — hardened across D060/D116/D123 against the operator-flow downgrade attack ("PASS: at first glance" then "FAIL"); rejects mid-prose verdicts; tested in `tests/post-completion.test.ts` and `tests/post-completion-router-warning.test.ts`.
- **Operator-legibility risk:** none — malformed reviews produce explicit recovery instructions (`post-completion-router-task-completion.ts:159` buildMalformedReviewFailReason).
- **Dependencies:** consumed by review and blind-review routers; prompt (buildReviewPrompt) must stay in lockstep with the parser anchors.
- **Disposition (recommended):** KEEP — security-relevant, well-tested, correct.
- **Flags:** none.

## Worktree verification (verifyWorktree / rebaseWorktreeOntoBase / collectDiff)
- **What:** Runs the workflow-profile verify commands in the worktree via `/bin/sh -c`, rebases the branch onto base (auto-aborting on conflict to dispatch a rebase-fix task), and collects a size-capped diff (50k chars) for review.
- **Where:** `post-completion.ts:151` (verifyWorktree), `:94` (rebaseWorktreeOntoBase), `:196` (collectDiff), `:187` (verificationEnv).
- **Maturity:** live-core
- **Quality:** adequate — large maxBuffer (64MB) avoids the misreported-failure bug; rebase auto-abort leaves a clean worktree; but execution is laptop-bound (host `/bin/sh`, no container/remote) per the established sandbox finding.
- **Operator-legibility risk:** partial — verify output is captured into evidence/snapshots, but a verify failure surfaces as a dispatched fix task rather than a direct operator signal.
- **Dependencies:** workflow-profile resolveVerifyCommands; git in PATH; the impl/fix routers.
- **Disposition (recommended):** REDESIGN — capability is correct but execution confinement is wrong (security/sandbox), and verificationEnv leaks secrets (see Flags).
- **Flags:** security — `verificationEnv()` (`post-completion.ts:187-191`) clones the ENTIRE host `process.env` and deletes only `DUCTUM_OPERATOR_TOKEN`; every verify command (agent-influenced via workflow profile) runs with full host secrets. Matches the established dispatch-secrets-leak finding; the encrypted FactorySecret system is not wired here.

## Review/fix/rebase prompt builders
- **What:** Construct the review, fix, warning-cleanup, and rebase-conflict prompts handed to agents, with input slices capped (verify 10k, diff in-prompt, rebase output 8k) and explicit "do not push/merge — Ductum owns shipping" guardrails.
- **Where:** `post-completion.ts:271` (buildReviewPrompt), `:388` (buildFixPrompt), `:352` (buildRebaseFixPrompt); verification-fix prompt inlined at `post-completion-router-verification-fix.ts:46-72`.
- **Maturity:** live-core
- **Quality:** solid — bounded inputs match the activity-limits posture; verdict-format instructions are exhaustive and kept in lockstep with the parser.
- **Operator-legibility risk:** none.
- **Dependencies:** consumed by dispatch/verification-fix routers; coupled to parseReviewResult format.
- **Disposition (recommended):** KEEP — the verification-fix prompt being inlined rather than in the prompt module is a minor inconsistency, not worth churn.
- **Flags:** none.

## Best-of-N blind-review routing
- **What:** Handles the bakeoff path: a blind reviewer's structured verdict selects a winner among >=2 candidates, validates policy/cost/done-state, atomically reopens the winner for approval with idempotent evidence, and records per-candidate outcomes with rollback if the ship handoff fails.
- **Where:** `post-completion-router-route-blind-review.ts:14` (runBlindReviewCompletion), `:135` (reopenCandidateForApproval), `:172` (selectWinner), `:228` (rollbackApprovalReopenIfStillUnshipped).
- **Maturity:** live-peripheral
- **Quality:** adequate — careful idempotency (createVerdictEvidenceOnce/createCandidateOutcomeEvidenceOnce) and explicit rollback, but it is the densest, highest-branch-count file in the domain (299 LOC, many failReviewTask early-returns) and is only exercised on the bakeoff/best-of-n path, not the normal single-agent flow.
- **Operator-legibility risk:** high — winner selection, policy mismatch, and "not terminal" rejections are encoded as failReviewTask reasons; an operator debugging a non-selected bakeoff must read evidence payloads and run stages to reconstruct what happened.
- **Dependencies:** bakeoff.ts, bakeoff-outcomes.ts, spec.strategyConfig (best_of_n), evidence repo (required, throws without it).
- **Disposition (recommended):** REUSE — sound foundation for the bakeoff feature but it should sit behind a clearer operator-facing outcome surface; verify it is still a live product path before investing.
- **Flags:** none functional; complexity/legibility risk noted.

## Auto-commit of dirty worktrees
- **What:** Before rebase/verify, creates one synthetic commit (fixed author `ductum-auto-commit`) covering any tracked/untracked/staged changes an agent left behind, so the clean-worktree requirement downstream is met instead of dying at merge.
- **Where:** `auto-commit.ts:51` (autoCommitWorktree), invoked from `post-completion-router-base.ts:52` (finalizeDirtyWorktree).
- **Maturity:** live-core
- **Quality:** solid — short-circuits on clean/missing worktree, scopes git config via `-c` flags so it does not leak into local config, uses `--no-verify --allow-empty`, returns structured result with error capture.
- **Operator-legibility risk:** none — commit message records that it was synthetic and traces to the task.
- **Dependencies:** git in PATH; the router base wires it in for impl and fix paths.
- **Disposition (recommended):** KEEP — targeted fix for a real Codex-harness behavior, cleanly bounded.
- **Flags:** none.

## Git artifact sync (branch/commit SHA)
- **What:** Reads HEAD branch + commit SHA from the worktree and persists them onto the Run record only when changed, so the dashboard/approval surfaces can show what will be merged.
- **Where:** `git-artifacts.ts:39` (readWorktreeGitArtifacts), `:52` (syncRunGitArtifacts); wired via `post-completion-router-base.ts:78` (syncGitArtifacts) and guarded by shouldSyncGitArtifacts.
- **Maturity:** live-core
- **Quality:** solid — tolerant of detached HEAD (filters bare "HEAD"), no-op when nothing changed, swallows git errors gracefully.
- **Operator-legibility risk:** none.
- **Dependencies:** RunRepo.updateGitArtifacts; git in PATH.
- **Disposition (recommended):** KEEP — small, correct, load-bearing for the merge/approval surface.
- **Flags:** none.

## Worktree snapshot evidence
- **What:** Builds typed `worktree.snapshot` evidence (branch, commit, diffstat vs base, capped verify-output tail) at each pipeline checkpoint, validated against the evidence schema before persistence.
- **Where:** `post-completion-snapshot.ts:10` (buildWorktreeSnapshotEvidence); recorded via `post-completion-router-base.ts:85` (recordWorktreeSnapshot) which calls validateEvidencePayload.
- **Maturity:** live-core
- **Quality:** solid — output tail bounded (40 lines / 4k chars), diffstat derives base via merge-base with fallbacks, payload schema-validated before write (D135 typed evidence). This is part of the AttemptRuntimeSnapshot sealing.
- **Operator-legibility risk:** none.
- **Dependencies:** evidence-kinds.ts (WorktreeSnapshotEvidence), evidence repo (optional), git.
- **Disposition (recommended):** REUSE — already a sealed-bundle field per the established snapshot finding; keep behind the sealed-job-bundle boundary.
- **Flags:** none.

## WorktreeManager (create / restore / remove / cleanupStale)
- **What:** Creates per-run git worktrees under `.ductum/worktrees/{project}/{task}-{shortId}/{repo}`, restores them, removes them, and GCs stale dirs by correlating the 6-char shortId suffix against an active-run set.
- **Where:** `worktree.ts:52` (WorktreeManager), `:78` (create), `:121` (restore), `:190` (cleanupStale).
- **Maturity:** live-core
- **Quality:** adequate — robust create/remove with fallback force-delete; stale GC has force/age modes. But it is host-filesystem-bound (laptop sandbox finding) and the shortId-regex correlation (`worktree.ts:214`) is a brittle naming coupling — a task name ending in a 6-char `-xxxxxx` segment could be misread as a run id.
- **Operator-legibility risk:** partial — cleanup logs are informative but worktree state is otherwise opaque to the operator.
- **Dependencies:** git worktree; consumed by dispatcher and the post-completion routers via run.worktreePaths.
- **Disposition (recommended):** REUSE — solid local implementation that should sit behind the future container/remote sandbox boundary (sandbox REDESIGN), not be rewritten now.
- **Flags:** bug — stale-GC shortId extraction is heuristic on directory naming (`worktree.ts:214`); a task slug whose own text ends in a 6-char token could collide. Low severity (false-preserve, not false-delete in active set) but worth noting.

## maxFixIterations resolution + deprecated maxReviewRounds fallback
- **What:** Resolves the fix-iteration cap from spec.maxFixIterations, then PostCompletionConfig.maxFixIterations, then the deprecated maxReviewRounds, then the default of 3.
- **Where:** `post-completion-router-verification-fix.ts:96` (maxFixIterations), deprecated field defined at `post-completion.ts:54-58`, fallback consumed at `:109`.
- **Maturity:** live-core (with one legacy-retired field still wired)
- **Quality:** adequate — correct precedence; the deprecated `maxReviewRounds` is documented as misnamed and kept only as a fallback.
- **Operator-legibility risk:** none.
- **Dependencies:** spec/postCompletion config.
- **Disposition (recommended):** REUSE — keep maxFixIterations; the `maxReviewRounds` fallback is a candidate for removal once callers are confirmed migrated.
- **Flags:** legacy — `maxReviewRounds` is the only remaining reference to the misnamed field; remove in a future major after grepping callers (`post-completion.ts:58`, `post-completion-router-verification-fix.ts:109`).

## Legacy / dead-but-not-deleted in this domain
- **Target vocabulary (`targetId`)** — `targetId: TargetId | null` survives on the Task type (`types.ts:152`) and is explicitly threaded into every task created by the routers (`post-completion-router-route-review.ts:127`, `post-completion-router-dispatch.ts:57` and `:109`, `post-completion-router-verification-fix.ts:42`). D169 retired the Target/targets operator surface (renamed to Repository/Component in P7/D169), but the field was never removed from the pipeline's task-creation paths. Candidate for REMOVE once the Task type drops the field.
- **`maxReviewRounds` deprecated config field** — `post-completion.ts:54-58` (definition) and `post-completion-router-verification-fix.ts:109` (fallback). Self-documented as misnamed; superseded by `maxFixIterations`. Candidate for REMOVE.
- **Grandfather LOC drift (not legacy code, but a retirement-discipline gap)** — `decisions/112-file-size-grandfather-list.md:31` records `post-completion.ts` at 483 LOC; the file is now 637 LOC. The file-size gate matches by path, so the +154 LOC growth slipped past the 300 LOC discipline. The grandfather entry says to extract "with a prompt/verification module pass" that has not happened. Not dead code, but the stale grandfather entry masks a file that has grown well beyond its recorded exception.
