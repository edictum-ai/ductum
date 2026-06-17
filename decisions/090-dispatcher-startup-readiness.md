# 090 - Dispatcher Startup Readiness

## Status

Accepted

## Context

`ductum doctor --deploy` currently reports a live factory as blocked because
the dispatcher has no harness adapters loaded. The live API process was started
without `--dispatch`, so the real operator problem is startup mode, not adapter
resolution. That collapsed reason blocks production operation because the fix is
to stop the stale API and start `pnpm serve`, not to debug Harness resources.

## Decision

Make dispatcher startup readiness reasons explicit:

- API startup records whether dispatch was requested.
- Dispatcher status distinguishes `server started without --dispatch` from
  `harness adapters failed to load` and from generic no-adapter availability.
- Manual dispatch fails with the same operator-visible startup reason instead
  of a misleading adapter error.
- `ductum doctor --deploy` carries the reason through unchanged and gives the
  matching recovery action.
- Harness adapter import failures are not swallowed into logs only.
- This is a readiness slice only. It does not change harness adapter behavior,
  Edictum enforcement, session mapping ownership, resource resolution, or the
  dispatcher loop.

## Why This Slice Comes Before More Sandbox Work

Decision `081` already implemented the first real `host/worktree`
SandboxProfile driver. The live deploy evidence now blocks on dispatcher startup
mode visibility. Ductum cannot be considered operational if the running API
cannot tell an operator why dispatch is unavailable.

## Non-Goals

- No new harness adapter, plugin model, marketplace, or provider abstraction.
- No resource-model change and no new top-level primitive/table.
- No Operation or WorkOrder table.
- No new dependency.
- No Edictum policy change or second policy system.
- No rewrite of `pnpm serve` process management in this slice.
