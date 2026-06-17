# 064 - Markdown Decision Drift Review

## Status

Accepted

## Context

Decision `060` requires generated prompts and reviews to carry a Decision Trace
and an explicit recorded why for approved drift. P4 needs a repeatable review
surface, but the current scope explicitly rejects building another policy engine
or graph analyzer inside Ductum.

## Decision

Add a small CLI prompt generator for decision-drift review.

- The command emits a Markdown review prompt for an existing spec.
- The prompt includes the active Decision Trace, non-goals, checklist, task
  prompt trace audit, and required drift-record format.
- The command warns when imported task prompts do not contain a Decision Trace.
- Enforcement remains outside this slice; Edictum is still the policy engine.

## Why This Is Not Drift

This implements the minimal direction from decision `060`: markdown-backed
review prompts plus recorded decisions/evidence. It does not add a second policy
system, schema graph, or formal traceability requirement.

## Non-Goals

- No second policy engine.
- No formal graph analyzer.
- No import-blocking gate in this slice.
- No new database tables.
