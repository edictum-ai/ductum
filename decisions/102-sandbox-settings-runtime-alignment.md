# 102 - Sandbox Settings Runtime Alignment

## Status

Accepted

## Context

Decision `081` makes `SandboxProfile(provider=host, mode=worktree)` the only
runtime-active sandbox driver. The Settings resource panel still creates new
SandboxProfile resources as `provider: local`, `mode: permissive`, and API
settings validation accepts agents that reference those unsupported profiles.

That leaves an operator trap: the Settings UI can save a resource-backed agent
configuration that looks valid, but dispatch later fails before harness session
creation.

## Decision

- Keep `SandboxProfile` as the existing config resource kind.
- Keep unreferenced SandboxProfile resources as declarative config shells.
- When an Agent references `resourceRefs.sandboxRef`, validate that the
  referenced SandboxProfile is supported by the current runtime driver before
  Agent create/update and settings save/validate complete.
- Reuse the core sandbox runtime validator for provider/mode and unsupported
  filesystem/network/credential/resource/process claims instead of duplicating
  those rules in API or dashboard code.
- Change the Settings structured resource panel's new SandboxProfile default to
  `provider: host`, `mode: worktree`.
- Preserve legacy agents without `sandboxRef`.
- Preserve declared `process` sandbox claims in the resource shell only so the
  shared runtime validator can reject referenced unsupported process claims
  before save/Agent writes; this is not a process-limit driver branch.
- Existing YAML with `process` sandbox claims is no longer normalized away.
  Unreferenced resources still persist as config shells, but referenced
  resources now fail visibly because the runtime does not implement process
  isolation.

## Why

The current production path has one real sandbox runtime. Resource-backed
settings should not let operators save an Agent reference to a sandbox profile
that the runtime already knows it cannot execute.

The API settings save and validate routes both call
`validateSettingsAgentRuntimeRefs`, so this decision applies equally to persisted
settings writes and validation-only checks. Factory-scope writes may still defer
project-scoped refs per decision `077`, but API accept and dispatcher boundaries
must close that deferral against the concrete spec project before run creation.

## Non-Goals

- No Docker, Podman, remote, microVM, cloud, network-isolated, credential, or
  resource-limit sandbox driver.
- No new top-level primitive, table, dependency, marketplace, or plugin
  abstraction.
- No second policy system and no Edictum behavior change.
- No broad dashboard redesign.
