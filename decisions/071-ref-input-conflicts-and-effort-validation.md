# 071 - Ref Input Conflicts And Effort Validation

## Status

Accepted

## Context

Decision `068` kept Agent `model` and `harness` columns as persisted
compatibility snapshots when refs exist. That does not mean API/settings input
should accept new direct `model` or `harness` values alongside the matching
`modelRef` or `harnessRef`. Accepting both makes one value silently disappear.

Uncataloged Model resources also cannot be validated against a static model
catalog. If an operator supplies `effort` for such a model without declaring
`supportedEfforts`, Ductum would be pretending to validate a provider-specific
choice it does not know.

## Decision

API create/update and settings config input must reject direct `model` when
`modelRef` is set, and reject direct `harness` when `harnessRef` is set. The
persisted Agent row may still store resolved model/harness snapshots after
validation; those snapshots are not accepted as competing user input.

When a Model resource points at an uncataloged `spec.modelId`, any requested
Agent `effort` requires `Model.spec.supportedEfforts`. Without that list,
effort validation fails loudly instead of accepting a value Ductum cannot
validate. Agents may still omit effort for uncataloged model resources.

## Why This Is Not Drift

This narrows input behavior to match the existing runtime authority model:
refs are authoritative when present, direct fields are legacy only when refs are
absent, and Ductum does not invent provider capability knowledge.

## Non-Goals

- No new model catalog.
- No new harness registry table.
- No policyRef runtime enforcement.
- No sandboxRef runtime enforcement.
- No second policy engine.
- No new dependency.
