# 072 - Model Resource Effort Authority

## Status

Accepted

## Context

Decision `071` made `supportedEfforts` mandatory before validating effort for
uncataloged Model resources. During review, the catalog fallback was still
ambiguous: a Model resource could omit `supportedEfforts` while pointing at a
cataloged `spec.modelId`, and Ductum would validate effort against the static
legacy catalog.

That mixes two authorities. A Model resource is the authority when `modelRef`
is present; the static catalog is only the authority for legacy direct
`Agent.model` input.

## Decision

Any Agent effort paired with a Model resource requires
`Model.spec.supportedEfforts`, regardless of whether the resolved `modelId`
also exists in the static model catalog. If `supportedEfforts` is absent, effort
validation fails loudly. Agents may omit effort for Model resources that do not
declare supported efforts.

## Why This Is Not Drift

This keeps resource-backed Agents resource-authoritative and keeps the static
model catalog as a legacy direct-input guard only.

## Non-Goals

- No new model catalog.
- No provider capability inference.
- No second policy engine.
- No new dependency.
