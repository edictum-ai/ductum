# 096 - Deploy Restart Guidance

## Status

Accepted

## Context

Decision `095` replaced Telegram deploy guidance that told operators to restart
`pnpm serve` with deployment-neutral wording: restart the Ductum API. Claude
review also flagged that the same `doctor --deploy` payload can still include
non-Telegram fixes that say `pnpm serve`, which is misleading for a production
deployment running under another process manager.

## Decision

Use deployment-neutral restart wording in deploy/operator readiness output and
operator-facing setup docs:

- Say "restart the Ductum API" instead of `pnpm serve` in deploy doctor,
  operator guidance, Telegram setup UI, and public setup recovery docs.
- Keep commands specific only when the command itself is the action, such as
  `pnpm build`.
- Do not change runtime behavior, process management, dispatcher semantics, or
  startup scripts.
- Do not add deployment manager detection in this slice.

## Why This Comes Next

The public deploy doctor is now the operator's readiness surface. It should not
give dev-only restart instructions while Ductum is being prepared for public
factory use.

## Non-Goals

- No process manager integration.
- No service supervisor, launchd, systemd, Docker, or cloud deployment support.
- No new dependency, table, provider branch, policy behavior, or startup script.
