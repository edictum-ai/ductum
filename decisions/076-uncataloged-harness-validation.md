# 076 - Uncataloged Harness Refs Do Not Use Static Model Matrix

## Status

Accepted

## Context

Harness resources can resolve to harness types that are not listed in the
static API `HARNESSES` catalog. The static catalog knows model compatibility
for built-in harnesses only.

## Decision

When `harnessRef` resolves outside the static harness catalog, API/settings
validation still requires any direct legacy `model` value to exist in the
static model catalog, but it does not apply the built-in model/harness
compatibility matrix. Dispatcher adapter availability remains the runtime gate
before run/session creation.

## Why This Is Not Drift

This preserves the harness resource model without inventing a second adapter or
policy registry in API validation.

## Non-Goals

- No second policy engine.
- No static catalog entry requirement for every Harness resource.
- No model/harness compatibility registry in this slice.
