# 066 - Behavior Contract Slop Review

## Status

Accepted

## Context

Decision `060` catches decision drift, but Ductum also needs to catch semantic
slop: shape-correct implementation that leaves runtime behavior ambiguous,
swallows errors, duplicates routing logic, or adds fake future infrastructure.

The riskiest areas are the control plane semantics and import/config surfaces.
Those need explicit behavior expectations before implementation and explicit
review pressure after implementation.

## Decision

Every active implementation prompt should include a required
`Behavior Contract` section.

Generated drift/review artifacts must include a `Slop Review` checklist and
must make missing or weak Behavior Contract coverage operator-visible.

The first enforcement surface is CLI/reporting:

- `spec drift-review` reports Decision Trace, Behavior Contract, Verification,
  Drift handling, and Slop Review coverage, and exits nonzero when coverage is
  incomplete so a generated review cannot be treated as PASS.
- `spec contract-check` renders the same coverage and exits nonzero when a spec
  or task prompt is incomplete.
- `spec contract-check --path` can lint an on-disk spec before import; YAML
  files with a mismatched `project:` are rejected.
- Weak Behavior Contracts that only assert shapes are called out explicitly.

## Why This Is Not Drift

This extends the markdown-backed review direction from decisions `059`, `060`,
and `064`. It does not add a table, a new top-level primitive, or a second
policy engine. Edictum remains the policy engine; Ductum records and surfaces
the contract evidence.

## Non-Goals

- No new database table.
- No formal graph analyzer.
- No second policy engine.
- No attempt to prove every Behavior Contract automatically.
- No dependency additions.
