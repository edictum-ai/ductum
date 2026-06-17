# 099 - Project Resource Apply

## Status

Accepted

## Context

Decision `098` made `ductum resource apply` handle mixed config resources,
Targets, and Agents through their existing APIs. A factory bootstrap manifest
still has to create the Project out of band before any Target document can
resolve `metadata.project`.

That keeps the product graph split across commands even though Project is
already an existing Ductum primitive and API resource.

## Decision

Teach `ductum resource apply` to accept `Project` documents:

- `Project` documents create or update existing Project rows through the
  existing Project API.
- `metadata.name` is the Project identity key.
- `spec.repos` and `spec.config` map to the existing project API payload.
- Target documents later in the same manifest may reference a Project created
  earlier in file order.
- Apply remains sequential and non-transactional; all document shapes are
  validated before the first write, and later API failures are loud.
- No Project migration into ConfigResource and no generic object store.

## Why This Comes Next

Unified apply made the resource graph mostly declarative, but bootstrap still
breaks unless the Project already exists. Supporting the existing Project
primitive in the same apply surface closes that gap without adding a new table,
runtime behavior, dependency, or policy path.

## Non-Goals

- No new Project table or Project-as-ConfigResource migration.
- No Factory manifest support in this slice.
- No Spec/Task manifest support in this slice.
- No transaction coordinator or rollback system.
- No Operation or WorkOrder primitive.
- No second policy system or Edictum behavior change.
- No new dependency.
