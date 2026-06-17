# 093 - Public URL DNS Resolve Semantics

## Status

Accepted

## Context

After adding the Cloudflare tunnel DNS route for
`factory.arnoldcartagena.com`, `dig` and Node `dns.resolve4/resolve6` returned
Cloudflare records, but `dns.lookup` and `curl` still failed through the local
system resolver cache. `ductum doctor --deploy` continued to report the public
base URL as unresolvable even though public DNS had the records Telegram needs.

## Decision

Deploy doctor public URL readiness should use public DNS record resolution:

- Resolve A and AAAA records with Node DNS resolver APIs.
- Treat the hostname as resolvable when either A or AAAA records exist.
- Fail loudly only when both A and AAAA resolution fail.
- Keep DNS checks read-only and independent from Telegram webhook setup.

## Why This Comes Next

The deployment blocker moved from missing DNS to stale local resolver semantics.
Doctor should report public DNS readiness, not local cache readiness.

## Non-Goals

- No DNS provider integration.
- No tunnel lifecycle manager.
- No Telegram API call from doctor.
- No new dependency.
- No table, primitive, Operation, or WorkOrder.
- No Edictum policy change or second policy system.
